import os
import sqlite3
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

# Basic CORS configuration to allow local/remote PeerVo clients to connect
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

DB_FILE = 'peervo_registry.db'

# Try importing pywebpush for background call alert processing
try:
    from pywebpush import webpush, WebPushException
    # Standard static VAPID Keys. In production, keep private_key safe!
    VAPID_PUBLIC_KEY = "BI9jA28R794YyD-YmQo_T1xW9K-V1v198gXmD-Yl876oKUpW-YadhR0Yv6vnrz5h4HhJG5jq0arBRuIrJdWXtQ"
    VID_PRIVATE_KEY = "LqUduWL7V0F7pOrYep5oTgZJaCXLl7eRvMZMpAE6DCA"
    PYWEBPUSH_AVAILABLE = True
except ImportError:
    PYWEBPUSH_AVAILABLE = False
    VAPID_PUBLIC_KEY = "INSTALL_PYWEBPUSH_FOR_BACKGROUND_CALLS"
    VID_PRIVATE_KEY = ""

def init_db():
    """Initializes SQLite database to persist registrations and push subscription tokens."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS directory (
            phone_number TEXT PRIMARY KEY,
            peer_id TEXT NOT NULL,
            subscription_info TEXT,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/api/status', methods=['GET'])
def get_status():
    """Simple status check route to verify the registry server is running."""
    return jsonify({
        "status": "online",
        "service": "PeerVo Registry System",
        "pywebpush_active": PYWEBPUSH_AVAILABLE,
        "version": "1.1.0"
    }), 200

@app.route('/api/vapid-public-key', methods=['GET'])
def get_vapid_key():
    """Returns the server VAPID key pair for registering notification subscriptions."""
    return jsonify({"publicKey": VAPID_PUBLIC_KEY}), 200

@app.route('/api/register', methods=['POST'])
def register_number():
    """Registers a new 10-digit phone number with its corresponding PeerJS ID."""
    data = request.json or {}
    phone_number = data.get('number', '').strip()
    peer_id = data.get('peerId', '').strip()

    if not phone_number.isdigit() or len(phone_number) != 10:
        return jsonify({"error": "Invalid phone number. Must be exactly 10 digits."}), 400
    
    if not peer_id:
        return jsonify({"error": "Missing PeerJS PeerID."}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT peer_id FROM directory WHERE phone_number = ?", (phone_number,))
        row = cursor.fetchone()
        
        if row:
            if row[0] == peer_id:
                return jsonify({"message": "Number already registered.", "number": phone_number}), 200
            else:
                return jsonify({"error": "This 10-digit number is already claimed by another device."}), 409
        
        cursor.execute("INSERT INTO directory (phone_number, peer_id) VALUES (?, ?)", (phone_number, peer_id))
        conn.commit()
        return jsonify({
            "success": True,
            "message": "Successfully registered number!",
            "number": phone_number,
            "peerId": peer_id
        }), 201

    except sqlite3.Error as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    finally:
        conn.close()

@app.route('/api/subscribe', methods=['POST'])
def subscribe_device():
    """Maps a user's notification push subscription to their phone number."""
    data = request.json or {}
    phone_number = data.get('number', '').strip()
    subscription = data.get('subscription')

    if not phone_number or not subscription:
        return jsonify({"error": "Missing registration data"}), 400

    subscription_str = json.dumps(subscription)

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE directory SET subscription_info = ? WHERE phone_number = ?", (subscription_str, phone_number))
        conn.commit()
        return jsonify({"success": True, "message": "Notification token mapped."}), 200
    except sqlite3.Error as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    finally:
        conn.close()

@app.route('/api/call-alert', methods=['POST'])
def trigger_call_push():
    """Wakes the callee's background Service Worker via Web Push if tab is closed."""
    data = request.json or {}
    caller = data.get('caller', '').strip()
    callee = data.get('callee', '').strip()
    is_video = data.get('video', False)

    if not callee:
        return jsonify({"error": "Missing target number"}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT subscription_info FROM directory WHERE phone_number = ?", (callee,))
    row = cursor.fetchone()
    conn.close()

    if row and row[0]:
        sub_info = json.loads(row[0])
        if PYWEBPUSH_AVAILABLE:
            try:
                payload = json.dumps({
                    "type": "INCOMING_CALL",
                    "caller": caller,
                    "isVideo": is_video
                })
                webpush(
                    subscription_info=sub_info,
                    data=payload,
                    vapid_private_key=VID_PRIVATE_KEY,
                    vapid_claims={"sub": "mailto:support@peervo.local"},
                    ttl=45
                )
                return jsonify({"success": True, "message": "Background wake notification successfully delivered."}), 200
            except WebPushException as ex:
                return jsonify({"success": False, "error": f"Push network delivery failure: {repr(ex)}"}), 500
        else:
            return jsonify({"success": False, "message": "WebPush library unavailable on server registry."}), 200

    return jsonify({"success": False, "message": "Callee has no active offline push subscription registered."}), 404

@app.route('/api/lookup/<phone_number>', methods=['GET'])
def lookup_number(phone_number):
    """Checks if a 10-digit number exists and returns its Peer ID."""
    phone_number = phone_number.strip()
    if not phone_number.isdigit() or len(phone_number) != 10:
        return jsonify({"error": "Invalid format. Must be 10 digits."}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT peer_id FROM directory WHERE phone_number = ?", (phone_number,))
    row = cursor.fetchone()
    conn.close()

    if row:
        return jsonify({
            "exists": True,
            "number": phone_number,
            "peerId": row[0]
        }), 200
    else:
        return jsonify({
            "exists": False,
            "message": "Number not found in directory."
        }), 404

@app.route('/api/deregister', methods=['POST'])
def deregister_number():
    """Unregisters a phone number from the registry."""
    data = request.json or {}
    phone_number = data.get('number', '').strip()
    peer_id = data.get('peerId', '').strip()

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM directory WHERE phone_number = ? AND peer_id = ?", (phone_number, peer_id))
    conn.commit()
    changes = conn.total_changes
    conn.close()

    if changes > 0:
        return jsonify({"success": True, "message": "Successfully deregistered number."}), 200
    return jsonify({"error": "No matching active registration found to deregister."}), 400

if __name__ == '__main__':
    print("------------------------------------------")
    print("  PeerVo Registry Server Running On Port 5000")
    if not PYWEBPUSH_AVAILABLE:
        print("  NOTICE: Run `pip install pywebpush` to enable background push alerts when tabs are closed.")
    print("  Press Ctrl+C to stop.")
    print("------------------------------------------")
    app.run(host='0.0.0.0', port=5000, debug=True)