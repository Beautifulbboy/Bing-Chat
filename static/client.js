(() => {
  const $ = (id) => document.getElementById(id);

  // --- 提醒功能相关变量 ---
  const ORIGINAL_TITLE = 'LAN Chat';
  const notificationSound = new Audio('/static/notify.mp3');
  let isWindowActive = true;
  let unreadMessages = 0;

  // --- 新增：图标闪烁相关变量 ---
  const favicon = $("favicon");
  const originalFaviconHref = favicon.href;
  // 使用 Data URI 创建一个透明的 favicon，无需额外文件
  const blankFaviconHref = "data:image/x-icon;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQEAYAAABPYyMiAAAABmJLR0T///////8JWPfcAAAACXBIWXMAAABIAAAASABGyWs+AAAAF0lEQVRIx2NgGAWjYBSMglEwCkbB8AAAAbwAACEr18wAAAAASUVORK5CYII=";
  let flashInterval = null;


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
  const chatArea = document.querySelector(".chat");
  
  // --- 新增：显示桌面通知函数 ---
  function showDesktopNotification(username, message, type) {
    if (Notification.permission !== 'granted') return;

    const notificationTitle = `来自 ${username} 的新消息`;
    const notificationBody = type === 'image' ? '[图片]' : message;
    
    const notification = new Notification(notificationTitle, {
      body: notificationBody,
      icon: '/static/favicon.ico' // 通知中显示的小图标
    });

    // 可选：点击通知时切换到聊天窗口
    notification.onclick = () => {
      window.focus();
    };
  }

  // --- 新增：控制图标闪烁的函数 ---
  function startFlashing() {
    if (flashInterval) return; // 防止重复启动
    flashInterval = setInterval(() => {
      favicon.href = favicon.href === originalFaviconHref ? blankFaviconHref : originalFaviconHref;
    }, 800);
  }

  function stopFlashing() {
    clearInterval(flashInterval);
    flashInterval = null;
    favicon.href = originalFaviconHref;
  }

  // --- 更新：addMessage 函数增加桌面通知和图标闪烁 ---
  function addMessage({ username, text, timestamp, type = 'text', self=false, system=false }) {
    if (!isWindowActive && !self && !system) {
      // 1. 播放声音
      notificationSound.play().catch(e => console.error("无法播放提示音:", e));
      
      // 2. 更新标题
      unreadMessages++;
      document.title = `(${unreadMessages}) ${ORIGINAL_TITLE}`;
      
      // 3. 显示桌面通知
      showDesktopNotification(username, text, type);
      
      // 4. 开始图标闪烁
      startFlashing();
    }

    const wrap = document.createElement("div");
    // (后续的 DOM 操作代码保持不变)
    if (system) {
      wrap.className = "system";
      const content = document.createElement("div");
      content.textContent = `[系统] ${text}`;
      wrap.appendChild(content);
    } else {
      wrap.className = `message ${self ? "self" : "other"}`;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${username} · ${timestamp}`;
      wrap.appendChild(meta);
      const content = document.createElement("div");
      if (type === 'image') {
        const img = document.createElement("img");
        img.src = text;
        img.onload = () => { messages.scrollTop = messages.scrollHeight; };
        content.appendChild(img);
      } else {
        content.textContent = text;
      }
      wrap.appendChild(content);
    }
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  }

  function setConnected(flag) {
    // (此函数保持不变)
    connected = flag;
    msgInput.disabled = !flag;
    sendBtn.disabled = !flag;
    connectBtn.textContent = flag ? "断开" : "连接";
    status.textContent = flag ? "已连接" : "未连接";
  }
  
  // --- 更新：connect 函数增加请求通知权限的逻辑 ---
  function connect() {
    if (connected) {
      socket.emit("leave", {});
      socket.disconnect();
      setConnected(false);
      return;
    }
    
    // --- DIAGNOSTICS START ---
    console.log("Attempting to connect and check notification permissions...");
    if (!("Notification" in window)) {
      console.error("This browser does not support desktop notifications.");
    } else {
      const currentPermission = Notification.permission;
      console.log('Current notification permission state:', currentPermission);
      
      if (currentPermission === "default") {
        console.log("Permission is 'default', requesting from user...");
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                console.log("Permission granted!");
                new Notification("LAN Chat", { body: "Notifications are now enabled!", icon: '/static/favicon.ico' });
            } else {
                console.warn("Permission denied by user.");
            }
        });
      } else if (currentPermission === "denied") {
          console.warn("Permission was previously denied. Please enable it in browser settings.");
      } else if (currentPermission === "granted") {
          console.log("Permission has already been granted.");
      }
    }

    const username = usernameInput.value.trim() || "Guest";
    const room = roomInput.value.trim() || "public";
    socket = io("/", { transports: ["websocket"] });
    socket.on("connect", () => {
      setConnected(true);
      messages.innerHTML = "";
      socket.emit("join", { username, room });
    });
    // (后续的 socket.on 监听器保持不变)
    socket.on("message", (data) => {
      addMessage({
        username: data.username,
        text: data.text,
        type: data.type,
        timestamp: data.timestamp,
        self: data.username === usernameInput.value.trim()
      });
    });
    socket.on("system", (data) => { addMessage({ text: data.message, timestamp: data.timestamp, system: true }); });
    socket.on("members", (data) => { memberList.innerHTML = ""; data.members.forEach((m) => { const li = document.createElement("li"); li.textContent = m; memberList.appendChild(li); }); });
    socket.on("typing", ({ username }) => { typing.textContent = `${username} 正在输入...`; });
    socket.on("stop_typing", () => { typing.textContent = ""; });
    socket.on("disconnect", () => { setConnected(false); });
  }

  function send() {
    // (此函数保持不变)
    const text = msgInput.value.trim();
    if (!text || !connected) return;
    socket.emit("message", { text });
    msgInput.value = "";
    socket.emit("stop_typing", {});
  }
  
  function sendImage(file) {
    // (此函数保持不变)
    if (!file || !connected) return;
    socket.emit('image', [file.name, file]);
  }

  // --- 更新：监听窗口激活状态以停止闪烁 ---
  document.addEventListener('visibilitychange', () => {
    isWindowActive = document.visibilityState === 'visible';
    if (isWindowActive) {
      unreadMessages = 0;
      document.title = ORIGINAL_TITLE;
      // 当用户返回此标签页时，停止图标闪烁
      stopFlashing();
    }
  });
  
  // (后续的事件监听器保持不变)
  msgInput.addEventListener("keydown", (e) => { if (!connected) return; if (e.key === "Enter") { e.preventDefault(); send(); return; } socket.emit("typing", {}); if (typingTimer) clearTimeout(typingTimer); typingTimer = setTimeout(() => socket.emit("stop_typing", {}), TYPING_TIMEOUT); });
  msgInput.addEventListener('paste', (e) => { if (!connected) return; const items = (e.clipboardData || window.clipboardData).items; for (const item of items) { if (item.kind === 'file' && item.type.startsWith('image/')) { e.preventDefault(); const file = item.getAsFile(); sendImage(file); return; } } });
  chatArea.addEventListener('dragover', (e) => { e.preventDefault(); chatArea.classList.add('dragover'); });
  chatArea.addEventListener('dragleave', (e) => { e.preventDefault(); chatArea.classList.remove('dragover'); });
  chatArea.addEventListener('drop', (e) => { e.preventDefault(); chatArea.classList.remove('dragover'); if (!connected) return; const files = e.dataTransfer.files; for (const file of files) { if (file.type.startsWith('image/')) { sendImage(file); } } });
  connectBtn.addEventListener("click", connect);
  sendBtn.addEventListener("click", send);
})();