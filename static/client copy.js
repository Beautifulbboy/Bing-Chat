(() => {
  const $ = (id) => document.getElementById(id);

  let socket = null;
  let connected = false;
  let typingTimer = null;
  const TYPING_TIMEOUT = 1200;

  const messages = $("messages");
  const typing = $("typing");
  const memberList = $("memberList");
  const status = $("status");
  const usernameInput = $("username");
  const roomInput = $("room");
  const msgInput = $("msgInput");
  const connectBtn = $("connectBtn");
  const sendBtn = $("sendBtn");

  function addMessage({ username, text, timestamp, self=false, system=false }) {
    const wrap = document.createElement("div");
    wrap.className = system ? "system" : `message ${self ? "self" : "other"}`;
    if (!system) {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${username} · ${timestamp}`;
      wrap.appendChild(meta);
    }
    const content = document.createElement("div");
    content.textContent = system ? `[系统] ${text}` : text;
    wrap.appendChild(content);
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  }

  function setConnected(flag) {
    connected = flag;
    msgInput.disabled = !flag;
    sendBtn.disabled = !flag;
    connectBtn.textContent = flag ? "断开" : "连接";
    status.textContent = flag ? "已连接" : "未连接";
  }

  function connect() {
    if (connected) {
      socket.emit("leave", {});
      socket.disconnect();
      setConnected(false);
      return;
    }
    const username = usernameInput.value.trim() || "Guest";
    const room = roomInput.value.trim() || "public";
    socket = io("/", { transports: ["websocket"] });
    socket.on("connect", () => {
      setConnected(true);
      messages.innerHTML = "";
      socket.emit("join", { username, room });
    });

    socket.on("message", (data) => {
      addMessage({ 
        username: data.username, 
        text: data.text, 
        timestamp: data.timestamp, 
        self: data.username === usernameInput.value.trim() 
      });
    });

    socket.on("system", (data) => {
      addMessage({ text: data.message, timestamp: data.timestamp, system: true });
    });

    socket.on("members", (data) => {
      memberList.innerHTML = "";
      data.members.forEach((m) => {
        const li = document.createElement("li");
        li.textContent = m;
        memberList.appendChild(li);
      });
    });

    socket.on("typing", ({ username }) => {
      typing.textContent = `${username} 正在输入...`;
    });

    socket.on("stop_typing", () => {
      typing.textContent = "";
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });
  }

  function send() {
    const text = msgInput.value.trim();
    if (!text || !connected) return;
    socket.emit("message", { text });
    msgInput.value = "";
    socket.emit("stop_typing", {});
  }

  msgInput.addEventListener("keydown", (e) => {
    if (!connected) return;
    if (e.key === "Enter") {
      e.preventDefault();
      send();
      return;
    }
    socket.emit("typing", {});
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => socket.emit("stop_typing", {}), TYPING_TIMEOUT);
  });

  connectBtn.addEventListener("click", connect);
  sendBtn.addEventListener("click", send);
})();