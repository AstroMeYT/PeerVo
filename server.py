import os
import sqlite3
import json
from flask import Flask, request, jsonify

app = Flask(__name__)

# Cross-Origin Resource Sharing (CORS) Configuration
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

DB_FILE = 'peervo_registry.db'

try:
    import firebase_admin
    from firebase_admin import credentials, messaging
    
    # Place your serviceAccountKey.json file in the same directory as this file
    # To download this, go to Firebase Console > Project Settings > Service Accounts > Generate New Private Key
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    FIREBASE_ADMIN_ACTIVE = True
    print("[INIT] Firebase Admin SDK successfully configured.")
except ImportError:
    FIREBASE_ADMIN_ACTIVE = False
    print("[WARNING] Run 'pip install firebase-admin' to execute background wake pushes.")
except Exception as e:
    FIREBASE_ADMIN_ACTIVE = False
    print(f"[WARNING] Firebase SDK failed to initialize: {e}. Missing serviceAccountKey.json.")

def init_db():
    """Initializes local SQLite database for device directories and push tokens."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS directory (
            phone_number TEXT PRIMARY KEY,
            peer_id TEXT NOT NULL,
            fcm_token TEXT,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_db()

@app.route('/api/status', methods=['GET'])
def get_status():
    """Status verification route."""
    return jsonify({
        "status": "online",
        "service": "PeerVo FCM Signaling Registry",
        "firebase_active": FIREBASE_ADMIN_ACTIVE,
        "version": "2.1.0"
    }), 200

@app.route('/api/register', methods=['POST'])
def register_number():
    """Registers/Maps a 10-digit number to its current PeerJS connection target."""
    data = request.json or {}
    phone_number = data.get('number', '').strip()
    peer_id = data.get('peerId', '').strip()

    if not phone_number.isdigit() or len(phone_number) != 10:
        return jsonify({"error": "Number must be exactly 10 digits."}), 400
    
    if not peer_id:
        return jsonify({"error": "Missing PeerJS target ID."}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT peer_id FROM directory WHERE phone_number = ?", (phone_number,))
        row = cursor.fetchone()
        
        if row:
            if row[0] == peer_id:
                return jsonify({"message": "Active listing updated.", "number": phone_number}), 200
            else:
                return jsonify({"error": "Line already registered to another terminal."}), 409
        
        cursor.execute("INSERT INTO directory (phone_number, peer_id) VALUES (?, ?)", (phone_number, peer_id))
        conn.commit()
        return jsonify({"success": True, "number": phone_number}), 201
    except sqlite3.Error as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/subscribe', methods=['POST'])
def subscribe_device():
    """Maps a generated device Firebase token identifier directly to its active line."""
    data = request.json or {}
    phone_number = data.get('number', '').strip()
    fcm_token = data.get('token', '').strip()

    if not phone_number or not fcm_token or fcm_token in ['undefined', 'null', 'None', '']:
        return jsonify({"error": "Registration request requires phone number and a valid token."}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE directory SET fcm_token = ? WHERE phone_number = ?", (fcm_token, phone_number))
        conn.commit()
        print(f"[REGISTRY] Token successfully mapped for line {phone_number}.")
        return jsonify({"success": True, "message": "FCM device registration updated."}), 200
    except sqlite3.Error as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/call-alert', methods=['POST'])
def trigger_call_push():
    """Wakes the callee's closed app wrapper using highly-reliable Firebase Cloud Messaging."""
    data = request.json or {}
    caller = data.get('caller', '').strip()
    callee = data.get('callee', '').strip()
    is_video = data.get('video', False)

    if not callee:
        return jsonify({"error": "Missing destination contact parameter."}), 400

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT fcm_token FROM directory WHERE phone_number = ?", (callee,))
    row = cursor.fetchone()
    conn.close()

    if row and row[0]:
        target_token = row[0].strip()
        
        if FIREBASE_ADMIN_ACTIVE:
            try:
                # Build unified Firebase Message payload
                message = messaging.Message(
                    data={
                        'type': 'INCOMING_CALL',
                        'caller': caller,
                        'isVideo': str(is_video).lower()
                    },
                    token=target_token,
                    # High priority wakes screens on devices even in idle/doze profiles
                    android=messaging.AndroidConfig(
                        priority='high'
                    ),
                    apns=messaging.APNSConfig(
                        payload=messaging.APNSPayload(
                            aps=messaging.Aps(content_available=True)
                        )
                    )
                )
                
                response = messaging.send(message)
                print(f"[PUSH] Message successfully sent to FCM. Dispatch tracking ID: {response}")
                return jsonify({"success": True, "message": "FCM payload successfully delivered."}), 200
            
            except messaging.UnregisteredError:
                # Catching dead or expired browser tokens and self-pruning the database.
                print(f"[CLEANUP] Pruning expired or unregistered token for line {callee}.")
                conn = sqlite3.connect(DB_FILE)
                cursor = conn.cursor()
                cursor.execute("UPDATE directory SET fcm_token = NULL WHERE phone_number = ?", (callee,))
                conn.commit()
                conn.close()
                return jsonify({
                    "success": False,
                    "error": "TokenExpired",
                    "message": "The recipient's registration token has expired or is no longer valid. Stale record automatically pruned from registry."
                }), 410

            except messaging.SenderIdMismatchError:
                # Occurs if your local serviceAccountKey.json is from a different project than your index.html/sw.js setup
                print("[ERROR] SenderIdMismatchError: Client Sender ID doesn't match serviceAccountKey.json's project!")
                return jsonify({
                    "success": False,
                    "error": "SenderIdMismatch",
                    "message": "Project Mismatch! Your index.html config credentials and your server-side serviceAccountKey.json belong to different Firebase projects."
                }), 403

            except firebase_admin.exceptions.InvalidArgumentError as ex:
                # Occurs if the token structure is modified, truncated, or invalid
                print(f"[ERROR] InvalidArgumentError triggered: {ex}")
                return jsonify({
                    "success": False,
                    "error": "InvalidArgument",
                    "message": f"Google rejected call parameters or token format: {ex}"
                }), 400

            except Exception as ex:
                # General SDK handler
                print(f"[ERROR] FCM push dispatch failed: {ex}")
                return jsonify({
                    "success": False,
                    "error": "FCMDispatchFailure",
                    "message": f"FCM Engine raised an internal error: {ex}"
                }), 500
        else:
            return jsonify({"success": False, "message": "Server Firebase credentials unconfigured."}), 200

    return jsonify({"success": False, "message": "Recipient has not mapped an active device token."}), 404

@app.route('/api/deregister', methods=['POST'])
def deregister_number():
    """Unregisters an active terminal listing."""
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
        return jsonify({"success": True}), 200
    return jsonify({"error": "No matching active registration found."}), 400

if __name__ == '__main__':
    print("-----------------------------------------------------------------")
    print("  PeerVo FCM Registry Server active on port 5000")
    print("  Be sure to install: pip install flask firebase-admin")
    print("-----------------------------------------------------------------")
    app.run(host='0.0.0.0', port=5000, debug=True)