from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os
import uuid # 用于生成唯一文件名

app = Flask(__name__, static_folder='static')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev')
# --- DATABASE CONFIGURATION ---
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://root:root@localhost/chat'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# --- UPLOAD FOLDER CONFIGURATION ---
UPLOAD_FOLDER = os.path.join(app.static_folder, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True) # 确保上传文件夹存在

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- DATABASE MODEL ---
class Message(db.Model):
    __tablename__ = 'messages'
    id = db.Column(db.Integer, primary_key=True)
    room = db.Column(db.String(100), nullable=False)
    username = db.Column(db.String(50), nullable=False)
    content = db.Column(db.Text, nullable=False)
    type = db.Column(db.Enum('text', 'image'), nullable=False, default='text')
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.now)

    # 更新 to_dict 方法以包含消息类型
    def to_dict(self):
        return {
            "username": self.username,
            "text": self.content, # 对于图片，content是URL
            "type": self.type,    # 增加 type 字段
            "timestamp": self.timestamp.isoformat(timespec="seconds")
        }

# (其他代码保持不变...)
users_by_sid = {}
room_members = {}

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

    with app.app_context():
        history = Message.query.filter_by(room=room).order_by(Message.timestamp).all()
        for msg in history:
            # to_dict 现在会包含 'type'，前端可以据此渲染历史消息中的图片
            emit("message", msg.to_dict(), to=request.sid)

    users_by_sid[request.sid] = {"username": username, "room": room}
    room_members.setdefault(room, set()).add(username)

    emit("system", {
        "message": f"{username} 加入了房间 {room}",
        "timestamp": datetime.now().isoformat(timespec="seconds")
    }, to=room)

    emit("members", {"room": room, "members": room_user_list(room)}, to=room)

@socketio.on("message")
def handle_message(data):
    user = users_by_sid.get(request.sid)
    if not user: return
    room, username = user["room"], user["username"]
    text = (data or {}).get("text", "").strip()
    if not text: return
    
    now = datetime.now()
    
    with app.app_context():
        new_message = Message(room=room, username=username, content=text, timestamp=now, type='text')
        db.session.add(new_message)
        db.session.commit()

    emit("message", {
        "username": username,
        "text": text,
        "type": "text", # 明确消息类型
        "timestamp": now.isoformat(timespec="seconds")
    }, to=room)


# --- 新增：图片处理器 ---
@socketio.on("image")
def handle_image(data):
    user = users_by_sid.get(request.sid)
    if not user:
        return
    room, username = user["room"], user["username"]
    
    # data 是一个包含 [文件名, 文件二进制数据] 的列表
    file_name_original = data[0]
    file_data = data[1]

    # 生成一个安全且唯一的文件名
    ext = os.path.splitext(file_name_original)[1] if '.' in file_name_original else '.png'
    unique_filename = f"{uuid.uuid4()}{ext}"
    upload_path = os.path.join(UPLOAD_FOLDER, unique_filename)
    
    # 将图片数据写入文件
    with open(upload_path, 'wb') as f:
        f.write(file_data)
    
    # 创建可供客户端访问的 URL
    image_url = f"/static/uploads/{unique_filename}"
    now = datetime.now()

    # 将图片信息保存到数据库
    with app.app_context():
        new_message = Message(room=room, username=username, content=image_url, timestamp=now, type='image')
        db.session.add(new_message)
        db.session.commit()

    # 向房间广播图片消息
    emit("message", {
        "username": username,
        "text": image_url, # 内容是图片的 URL
        "type": "image",      # 消息类型是图片
        "timestamp": now.isoformat(timespec="seconds")
    }, to=room)


# (其他处理器 on("typing"), on("leave") 等保持不变...)
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
        db.create_all()
    socketio.run(app, host="0.0.0.0", port=2333, debug=True)