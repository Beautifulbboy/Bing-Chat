from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os

app = Flask(__name__, static_folder='static')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev')
# --- DATABASE CONFIGURATION ---
# IMPORTANT: Replace 'root:your_password@localhost' with your MySQL credentials.
# Format: 'mysql+pymysql://<user>:<password>@<host>/<dbname>'
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://root:root@localhost/chat'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- DATABASE MODEL ---
class Message(db.Model):
    __tablename__ = 'messages'
    id = db.Column(db.Integer, primary_key=True)
    room = db.Column(db.String(100), nullable=False)
    username = db.Column(db.String(50), nullable=False)
    content = db.Column(db.Text, nullable=False)
    # The 'type' column from your table is included here.
    # The app currently only handles 'text', but the model supports 'image'.
    type = db.Column(db.Enum('text', 'image'), nullable=False, default='text')
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.now)

    def to_dict(self):
        return {
            "username": self.username,
            "text": self.content,
            "timestamp": self.timestamp.isoformat(timespec="seconds")
        }

# Track users per room
users_by_sid = {}          # sid -> {"username": str, "room": str}
room_members = {}          # room -> set of usernames

@app.route("/")
def index():
    return render_template("index.html")

def room_user_list(room):
    return sorted(list(room_members.get(room, set())))

@socketio.on("join")
def on_join(data):
    username = data.get("username", "Guest")
    room = data.get("room", "public")
    join_room(room)

    # --- LOAD AND SEND CHAT HISTORY ---
    # When a user joins, fetch history from DB and send it to only that user.
    with app.app_context():
        history = Message.query.filter_by(room=room).order_by(Message.timestamp).all()
        for msg in history:
            emit("message", msg.to_dict(), to=request.sid)

    # Save user
    users_by_sid[request.sid] = {"username": username, "room": room}
    room_members.setdefault(room, set()).add(username)

    # Notify room
    emit("system", {
        "message": f"{username} 加入了房间 {room}",
        "timestamp": datetime.now().isoformat(timespec="seconds")
    }, to=room)

    # Send updated member list
    emit("members", {"room": room, "members": room_user_list(room)}, to=room)

@socketio.on("message")
def handle_message(data):
    user = users_by_sid.get(request.sid)
    if not user: 
        return
    room = user["room"]
    username = user["username"]
    text = (data or {}).get("text", "").strip()
    if not text:
        return
    
    now = datetime.now()
    
    # --- SAVE MESSAGE TO DATABASE ---
    with app.app_context():
        new_message = Message(
            room=room,
            username=username,
            content=text,
            timestamp=now,
            type='text' # Currently hardcoded as 'text'
        )
        db.session.add(new_message)
        db.session.commit()

    # Emit message to all clients in the room
    emit("message", {
        "username": username,
        "text": text,
        "timestamp": now.isoformat(timespec="seconds")
    }, to=room)

@socketio.on("typing")
def handle_typing(_data):
    user = users_by_sid.get(request.sid)
    if not user:
        return
    emit("typing", {"username": user["username"]}, to=user["room"], include_self=False)

@socketio.on("stop_typing")
def handle_stop_typing(_data):
    user = users_by_sid.get(request.sid)
    if not user:
        return
    emit("stop_typing", {"username": user["username"]}, to=user["room"], include_self=False)

@socketio.on("leave")
def on_leave(_data):
    user = users_by_sid.get(request.sid)
    if not user:
        return
    username = user["username"]
    room = user["room"]
    leave_room(room)
    # Update trackers
    room_members.get(room, set()).discard(username)
    users_by_sid.pop(request.sid, None)

    emit("system", {
        "message": f"{username} 离开了房间 {room}",
        "timestamp": datetime.now().isoformat(timespec="seconds")
    }, to=room)
    emit("members", {"room": room, "members": room_user_list(room)}, to=room)

@socketio.on("disconnect")
def on_disconnect():
    user = users_by_sid.get(request.sid)
    if not user:
        return
    username = user["username"]
    room = user["room"]
    room_members.get(room, set()).discard(username)
    users_by_sid.pop(request.sid, None)
    emit("system", {
        "message": f"{username} 断开连接",
        "timestamp": datetime.now().isoformat(timespec="seconds")
    }, to=room)
    emit("members", {"room": room, "members": room_user_list(room)}, to=room)

if __name__ == "__main__":
    with app.app_context():
        # This will create the 'messages' table if it doesn't exist
        # based on the model defined above.
        db.create_all()
    # 绑定 0.0.0.0 以便局域网访问；如需改端口修改 port
    socketio.run(app, host="0.0.0.0", port=2333, debug=True)