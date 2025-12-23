import { useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'
import EmojiPicker from 'emoji-picker-react'

// Socket fallback
// const SOCKET_URLS = [
//   "http://10.93.17.241:3000",
//   "http://10.93.22.210:3000"
// ]

// let socket
// for (const url of SOCKET_URLS) {
//   try {
//     socket = io(url, { timeout: 2000 })
//     break
//   } catch (err) {
//     console.error("Không kết nối được:", url)
//   }
// }
const socket = io("https://roomchat-ixt3.onrender.com")

// VAPID public key
const PUBLIC_VAPID_KEY = 'BPGHv4kLY7Rv-mbja7YOb1J3LfErVjjQvEFDOiNunKmz2SurewqqaCg35lCJ1AsgouEPS_4jpYvghUma40e4BvA'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export default function ChatRoom() {
  const [room, setRoom] = useState("general")
  const [username, setUsername] = useState("")
  const [joined, setJoined] = useState(false)
  const [messages, setMessages] = useState([])
  const [users, setUsers] = useState([])
  const [onlineUsersList, setOnlineUsersList] = useState([])
  const [input, setInput] = useState("")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.theme || 'system')
  const [attachedImage, setAttachedImage] = useState(null)
  const [rooms, setRooms] = useState([
    { id: 'general', icon: '🏠', label: 'Sảnh chung', type: 'public' },
    { id: 'sports', icon: '⚽', label: 'Thể thao', type: 'public' },
    { id: 'music', icon: '🎵', label: 'Âm nhạc', type: 'public' },
  ])
  const [privateRooms, setPrivateRooms] = useState([])
  const [newRoomName, setNewRoomName] = useState("")
  const [newRoomType, setNewRoomType] = useState("group")
  const [joinRoomId, setJoinRoomId] = useState("")
  const [joinRequests, setJoinRequests] = useState([])
  const [pushEnabled, setPushEnabled] = useState(false)
  const [unreadCounts, setUnreadCounts] = useState({})
  const [dmTarget, setDmTarget] = useState(null) // Tên người chat riêng

  const fileInputRef = useRef(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Auto scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Dark mode
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        document.documentElement.classList.toggle('dark', mediaQuery.matches)
      }
    }
    mediaQuery.addEventListener('change', handleChange)
    if (theme === 'dark' || (theme === 'system' && mediaQuery.matches)) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    if (theme === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', theme)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  // Socket connection & events
  useEffect(() => {
    if (!joined) return
  
    socket.emit("getUserRooms")
  
    // Reset messages & unread khi chuyển phòng
    setMessages([])
    setUnreadCounts(prev => ({ ...prev, [room]: 0 }))
  
    socket.emit("joinRoom", room, username)
  
    socket.on("loadMessages", (history) => {
      setMessages(history || [])
    })
  
    socket.on("message", (msg) => {
      setMessages(prev => [...prev, msg])
    })
  
    socket.on("roomUsers", setUsers)
  
    // Sửa onlineUsers: luôn cập nhật danh sách mới, tránh cache cũ
    socket.on("onlineUsers", (list) => {
      setOnlineUsersList(list.map(name => ({ name })))
    })
  
    socket.on("newRoomCreated", (newRoom) => {
      if (newRoom.type === 'public') {
        setRooms(p => [...p.filter(r => r.id !== newRoom.id), newRoom])
      } else if (newRoom.type === 'group') {
        setPrivateRooms(p => [...p.filter(r => r.id !== newRoom.id), newRoom])
      } else if (newRoom.type === 'dm') {
        // Vào chat riêng trực tiếp
        setRoom(newRoom.id)
        setMessages([])
        setDmTarget(newRoom.label.split(' and ').find(name => name !== username) || "Người lạ")
        setTimeout(() => inputRef.current?.focus(), 300)
      }
    })
  
    socket.on("joinRequest", (req) => setJoinRequests(prev => [...prev, req]))
  
    socket.on("joinApproved", (approved) => {
      if (approved.type === 'group') {
        setPrivateRooms(p => [...p.filter(r => r.id !== approved.id), approved])
        setRoom(approved.id)
      } else if (approved.type === 'dm') {
        setRoom(approved.id)
        setDmTarget(approved.label.split(' and ').find(name => name !== username) || "Người lạ")
        setTimeout(() => inputRef.current?.focus(), 300)
      }
      setUnreadCounts(prev => ({ ...prev, [approved.id]: 0 }))
    })
  
    socket.on("userRooms", ({ privateRooms: pr }) => {
      setPrivateRooms(pr)
    })
  
    socket.on("unreadUpdate", (counts) => {
      setUnreadCounts(counts)
    })
  
    return () => {
      socket.off("loadMessages")
      socket.off("message")
      socket.off("roomUsers")
      socket.off("onlineUsers")
      socket.off("newRoomCreated")
      socket.off("joinRequest")
      socket.off("joinApproved")
      socket.off("userRooms")
      socket.off("unreadUpdate")
      socket.emit("leaveRoom", room, username)
    }
  }, [room, username, joined])

  // Paste image
  useEffect(() => {
    const handlePaste = (e) => {
      for (const item of e.clipboardData?.items || []) {
        if (item.type.startsWith('image/')) {
          const reader = new FileReader()
          reader.onload = () => setAttachedImage(reader.result)
          reader.readAsDataURL(item.getAsFile())
          break
        }
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

  // Push notification
  const enablePush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
      })
      socket.emit('subscribePush', sub)
      setPushEnabled(true)
    } catch (err) {
      console.error('Push failed:', err)
    }
  }

  // Send message
  const sendMessage = (e) => {
    e.preventDefault()
    let msg = input.trim()
    if (attachedImage) msg = msg ? `${msg} [image]${attachedImage}` : `[image]${attachedImage}`
    if (msg) {
      socket.emit("chatMessage", { room, message: `${username}: ${msg}` })
      setInput("")
      setAttachedImage(null)
      setUnreadCounts(prev => ({ ...prev, [room]: 0 }))
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file?.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => setAttachedImage(reader.result)
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const removeAttachment = () => setAttachedImage(null)

  const createRoom = () => {
    if (!newRoomName.trim()) return
    const data = {
      id: newRoomName.trim().toLowerCase().replace(/\s+/g, '-'),
      label: newRoomName.trim(),
      type: newRoomType,
      owner: username
    }
    socket.emit("createRoom", data)
    setNewRoomName("")
  }

  const requestJoin = () => {
    if (!joinRoomId.trim()) return
    socket.emit("requestJoin", { room: joinRoomId.trim(), user: username })
    setJoinRoomId("")
  }

  const approveJoin = (id, approve) => {
    socket.emit("approveJoin", { requestId: id, approve })
    setJoinRequests(prev => prev.filter(r => r.id !== id))
  }

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen)

  const changeTheme = (t) => setTheme(t)

  const startDM = (targetUser) => {
    if (targetUser === username) return
    const data = {
      type: 'dm',
      targetUser
    }
    socket.emit("createRoom", data)
  }

  const chatPlaceholder = dmTarget
    ? `Nhắn tin cho ${dmTarget}...`
    : `Gửi tin nhắn tới #${room}...`

  // Login screen
  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-700 p-4">
        <div className="bg-white dark:bg-gray-800 p-6 sm:p-10 rounded-3xl shadow-2xl w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-block bg-blue-100 dark:bg-blue-900/50 p-5 rounded-full mb-4">
              <span className="text-6xl">🚀</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-800 dark:text-white">CHAT FUNNY</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2 text-base sm:text-lg">Nhập tên để bắt đầu kết nối</p>
          </div>
          <input
            autoFocus
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && username && setJoined(true)}
            placeholder="Tên của bạn là gì?"
            className="w-full border-2 border-gray-100 dark:border-gray-700 rounded-2xl px-5 py-4 mb-5 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50 dark:focus:ring-blue-900/50 transition-all text-lg text-gray-900 dark:text-gray-100"
          />
          <button
            onClick={() => setJoined(true)}
            disabled={!username}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:text-gray-400 text-white font-bold py-4 rounded-2xl transition-all shadow-lg text-lg"
          >
            Vào phòng ngay
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 font-sans overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-80 lg:w-96 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-col shadow-sm shrink-0">
        <div className="p-5 border-b border-gray-100 dark:border-gray-700">
          <h1 className="text-2xl font-black text-blue-600 dark:text-blue-400 tracking-tighter">CHAT FUNNY</h1>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Users */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
              ĐANG ONLINE ({onlineUsersList.length})
            </h3>
            <ul className="space-y-2">
              {onlineUsersList.map((u, i) => (
                <li 
                  key={i} 
                  className="group relative flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="relative">
                    <div className="w-9 h-9 lg:w-10 lg:h-10 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center font-bold text-gray-600 dark:text-gray-300 uppercase">
                      {u.name.charAt(0)}
                    </div>
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full"></div>
                  </div>
                  <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{u.name}</span>
                  {u.name === username && (
                    <span className="text-[10px] font-bold text-blue-500 bg-blue-50 dark:bg-blue-900/50 px-2 py-0.5 rounded-full">BẠN</span>
                  )}
                  {u.name !== username && (
                    <button
                      onClick={() => startDM(u.name)}
                      className="absolute right-3 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 hover:text-blue-600 text-xl"
                      title="Chat riêng"
                    >
                      💬
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Public Rooms */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">PHÒNG TỰ DO</h3>
            <div className="space-y-2">
              {rooms.map(r => (
                <button
                  key={r.id}
                  onClick={() => { 
                    setRoom(r.id); 
                    setMessages([]); 
                    setUnreadCounts(p => ({ ...p, [r.id]: 0 })); 
                    setDmTarget(null)
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl font-bold transition-all ${
                    room === r.id ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-2xl">{r.icon || '📁'}</span>
                    <span className="truncate">{r.label}</span>
                  </div>
                  {unreadCounts[r.id] > 0 && (
                    <span 
                      className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full"
                      title={`Có ${unreadCounts[r.id]} tin chưa đọc`}
                    >
                      {unreadCounts[r.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Private Group Rooms */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">PHÒNG NHÓM RIÊNG</h3>
            <div className="space-y-2">
              {privateRooms.map(r => (
                <button
                  key={r.id}
                  onClick={() => { 
                    setRoom(r.id); 
                    setMessages([]); 
                    setUnreadCounts(p => ({ ...p, [r.id]: 0 })); 
                    setDmTarget(null)
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl font-bold transition-all ${
                    room === r.id ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-2xl">🔒</span>
                    <span className="truncate">{r.label}</span>
                  </div>
                  {unreadCounts[r.id] > 0 && (
                    <span 
                      className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full"
                      title={`Có ${unreadCounts[r.id]} tin chưa đọc`}
                    >
                      {unreadCounts[r.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Create New Room */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">TẠO PHÒNG MỚI</h3>
            <select
              value={newRoomType}
              onChange={e => setNewRoomType(e.target.value)}
              className="w-full mb-2 p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="public">Tự do (Public)</option>
              <option value="group">Nhóm riêng (cần phê duyệt)</option>
            </select>
            <input
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              placeholder="Tên phòng mới"
              className="w-full mb-2 p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={createRoom}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              Tạo phòng
            </button>
          </section>

          {/* Request Join */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">YÊU CẦU THAM GIA PHÒNG RIÊNG</h3>
            <input
              value={joinRoomId}
              onChange={e => setJoinRoomId(e.target.value)}
              placeholder="ID phòng riêng (ví dụ: ten-phong)"
              className="w-full mb-2 p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={requestJoin}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              Gửi yêu cầu
            </button>
          </section>

          {/* Push */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">THÔNG BÁO PUSH</h3>
            <button
              onClick={enablePush}
              disabled={pushEnabled}
              className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                pushEnabled ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {pushEnabled ? 'Đã kích hoạt' : 'Kích hoạt thông báo'}
            </button>
          </section>

          {/* Join Requests */}
          {joinRequests.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">YÊU CẦU THAM GIA</h3>
              <ul className="space-y-2">
                {joinRequests.map(req => (
                  <li key={req.id} className="flex flex-col gap-2 p-3 rounded-xl bg-gray-100 dark:bg-gray-700">
                    <span className="text-gray-800 dark:text-gray-200">{req.user} → {req.room}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveJoin(req.id, true)}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white py-1.5 rounded-lg text-sm transition-colors"
                      >
                        Đồng ý
                      </button>
                      <button
                        onClick={() => approveJoin(req.id, false)}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white py-1.5 rounded-lg text-sm transition-colors"
                      >
                        Từ chối
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* User info & Theme */}
        <div className="p-5 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 lg:w-12 lg:h-12 bg-indigo-500 rounded-2xl flex items-center justify-center text-white font-black shadow-inner">
              {username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate text-gray-900 dark:text-white">{username}</p>
              <p className="text-xs text-green-600 dark:text-green-400">Đang hoạt động</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => changeTheme('light')}
              className={`flex-1 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                theme === 'light' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              ☀️ Light
            </button>
            <button
              onClick={() => changeTheme('dark')}
              className={`flex-1 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                theme === 'dark' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              🌙 Dark
            </button>
            <button
              onClick={() => changeTheme('system')}
              className={`flex-1 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                theme === 'system' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              ⚙️ System
            </button>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-gray-50 dark:bg-gray-900">
        {/* Header */}
        <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="md:hidden p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="text-2xl font-light text-gray-500 dark:text-gray-400">#</span>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white truncate">
              {dmTarget ? `Chat với ${dmTarget}` : room}
              {unreadCounts[room] > 0 && (
                <span 
                  className="ml-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full"
                  title={`Có ${unreadCounts[room]} tin chưa đọc`}
                >
                  {unreadCounts[room]}
                </span>
              )}
            </h2>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-600">
              <span className="text-6xl sm:text-8xl mb-4 opacity-50">💬</span>
              <p className="text-lg sm:text-xl font-medium italic">Chưa có tin nhắn nào. Bắt đầu trò chuyện ngay!</p>
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-6 max-w-4xl mx-auto">
              {messages.map((m, i) => {
                const isMe = m.startsWith(username + ":")
                const parts = m.split(':')
                const sender = parts[0]?.trim()
                const content = parts.slice(1).join(':').trim()
                const isSystem = sender === "Hệ thống"

                if (isSystem) return (
                  <p key={i} className="text-center text-xs sm:text-sm text-gray-400 dark:text-gray-500 italic py-4">
                    {content}
                  </p>
                )

                const [text, ...imgs] = content.split('[image]')
                const hasText = text.trim()

                return (
                  <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] sm:max-w-[70%] rounded-3xl px-4 py-3 shadow-sm ${
                      isMe
                        ? 'bg-blue-600 text-white rounded-tr-none'
                        : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-tl-none border border-gray-200 dark:border-gray-700'
                    }`}>
                      {!isMe && (
                        <p className="text-[10px] sm:text-xs font-bold text-blue-500 dark:text-blue-400 mb-1 uppercase">
                          {sender}
                        </p>
                      )}
                      {hasText && (
                        <p className="text-sm sm:text-base leading-relaxed break-words mb-2">
                          {hasText}
                        </p>
                      )}
                      {imgs.map((src, idx) => src && (
                        <img
                          key={idx}
                          src={src}
                          alt="Shared"
                          className="max-w-full h-auto rounded-lg mt-2"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
              <div ref={scrollRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <footer className="p-4 sm:p-6 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 shrink-0">
          <div className="max-w-4xl mx-auto">
            {attachedImage && (
              <div className="mb-3 flex items-center gap-3">
                <img
                  src={attachedImage}
                  alt="Preview"
                  className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                />
                <button
                  onClick={removeAttachment}
                  className="p-2 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 rounded-full hover:bg-red-50 dark:hover:bg-red-900/30"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            <form onSubmit={sendMessage} className="flex items-center gap-2 sm:gap-3 bg-gray-100 dark:bg-gray-700 p-2 sm:p-3 rounded-3xl border border-gray-200 dark:border-gray-600">
              <button
                type="button"
                onClick={() => setShowPicker(p => !p)}
                className="p-2 sm:p-3 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <span className="text-xl sm:text-2xl">😊</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 sm:p-3 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={chatPlaceholder}
                className="flex-1 bg-transparent px-3 py-2 sm:py-3 text-sm sm:text-base text-gray-900 dark:text-gray-100 focus:outline-none"
              />

              <button
                type="submit"
                disabled={!input.trim() && !attachedImage}
                className={`p-3 sm:p-4 rounded-2xl transition-all ${
                  input.trim() || attachedImage
                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                    : 'bg-gray-300 dark:bg-gray-600 text-gray-400 cursor-not-allowed'
                }`}
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6 transform rotate-90" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            </form>

            {showPicker && (
              <div className="absolute bottom-full left-0 mb-3 z-50">
                <EmojiPicker
                  onEmojiClick={({ emoji }) => {
                    setInput(p => p + emoji)
                    setShowPicker(false)
                  }}
                  theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}
                />
              </div>
            )}
          </div>
        </footer>
      </main>

      {/* Mobile Drawer */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden" onClick={toggleSidebar} />
          <aside className="fixed inset-y-0 left-0 z-50 w-80 bg-white dark:bg-gray-800 shadow-2xl transform transition-transform duration-300 ease-in-out md:hidden overflow-y-auto">
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
              <h1 className="text-2xl font-black text-blue-600 dark:text-blue-400">CHAT FUNNY</h1>
              <button onClick={toggleSidebar} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                <svg className="w-6 h-6 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-6">
              {/* Users */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
                  ĐANG ONLINE ({onlineUsersList.length})
                </h3>
                <ul className="space-y-2">
                  {onlineUsersList.map((u, i) => (
                    <li 
                      key={i} 
                      className="group relative flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="relative">
                        <div className="w-9 h-9 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center font-bold text-gray-600 dark:text-gray-300 uppercase">
                          {u.name.charAt(0)}
                        </div>
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full"></div>
                      </div>
                      <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{u.name}</span>
                      {u.name === username && <span className="text-[10px] font-bold text-blue-500 bg-blue-50 dark:bg-blue-900/50 px-2 py-0.5 rounded-full">BẠN</span>}
                      {u.name !== username && (
                        <button
                          onClick={() => { startDM(u.name); toggleSidebar(); }}
                          className="absolute right-3 text-blue-500 hover:text-blue-600 text-xl"
                          title="Chat riêng"
                        >
                          💬
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              {/* Public Rooms */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">PHÒNG TỰ DO</h3>
                <div className="space-y-2">
                  {rooms.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { 
                        setRoom(r.id); 
                        setMessages([]); 
                        setUnreadCounts(p => ({ ...p, [r.id]: 0 })); 
                        setDmTarget(null); 
                        toggleSidebar(); 
                      }}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl font-bold transition-all ${
                        room === r.id ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-2xl">{r.icon || '📁'}</span>
                        <span className="truncate">{r.label}</span>
                      </div>
                      {unreadCounts[r.id] > 0 && (
                        <span 
                          className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full"
                          title={`Có ${unreadCounts[r.id]} tin chưa đọc`}
                        >
                          {unreadCounts[r.id]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>

              {/* Private Group Rooms */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">PHÒNG NHÓM RIÊNG</h3>
                <div className="space-y-2">
                  {privateRooms.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { 
                        setRoom(r.id); 
                        setMessages([]); 
                        setUnreadCounts(p => ({ ...p, [r.id]: 0 })); 
                        setDmTarget(null); 
                        toggleSidebar(); 
                      }}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl font-bold transition-all ${
                        room === r.id ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <span className="text-2xl">🔒</span>
                        <span className="truncate">{r.label}</span>
                      </div>
                      {unreadCounts[r.id] > 0 && (
                        <span 
                          className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full"
                          title={`Có ${unreadCounts[r.id]} tin chưa đọc`}
                        >
                          {unreadCounts[r.id]}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>

              {/* Tạo phòng mới */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">TẠO PHÒNG MỚI</h3>
                <select
                  value={newRoomType}
                  onChange={e => setNewRoomType(e.target.value)}
                  className="w-full mb-2 p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="public">Tự do (Public)</option>
                  <option value="group">Nhóm riêng (cần phê duyệt)</option>
                </select>
                <input
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  placeholder="Tên phòng mới"
                  className="w-full mb-2 p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => { createRoom(); toggleSidebar(); }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors"
                >
                  Tạo phòng
                </button>
              </section>

              {/* Request Join */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">YÊU CẦU THAM GIA PHÒNG RIÊNG</h3>
                <input
                  value={joinRoomId}
                  onChange={e => setJoinRoomId(e.target.value)}
                  placeholder="ID phòng riêng (ví dụ: ten-phong)"
                  className="w-full mb-2 p-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => { requestJoin(); toggleSidebar(); }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors"
                >
                  Gửi yêu cầu
                </button>
              </section>

              {/* Push */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">THÔNG BÁO PUSH</h3>
                <button
                  onClick={() => { enablePush(); toggleSidebar(); }}
                  disabled={pushEnabled}
                  className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                    pushEnabled ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {pushEnabled ? 'Đã kích hoạt' : 'Kích hoạt thông báo'}
                </button>
              </section>

              {/* Join Requests */}
              {joinRequests.length > 0 && (
                <section>
                  <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">YÊU CẦU THAM GIA</h3>
                  <ul className="space-y-2">
                    {joinRequests.map(req => (
                      <li key={req.id} className="flex flex-col gap-2 p-3 rounded-xl bg-gray-100 dark:bg-gray-700">
                        <span className="text-gray-800 dark:text-gray-200">{req.user} → {req.room}</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { approveJoin(req.id, true); toggleSidebar(); }}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-1.5 rounded-lg text-sm transition-colors"
                          >
                            Đồng ý
                          </button>
                          <button
                            onClick={() => { approveJoin(req.id, false); toggleSidebar(); }}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-1.5 rounded-lg text-sm transition-colors"
                          >
                            Từ chối
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Theme */}
              <section>
                <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">CHỦ ĐỀ</h3>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => { changeTheme('light'); toggleSidebar(); }}
                    className={`px-3 py-2 rounded-full text-sm ${theme === 'light' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                  >
                    ☀️ Light
                  </button>
                  <button
                    onClick={() => { changeTheme('dark'); toggleSidebar(); }}
                    className={`px-3 py-2 rounded-full text-sm ${theme === 'dark' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                  >
                    🌙 Dark
                  </button>
                  <button
                    onClick={() => { changeTheme('system'); toggleSidebar(); }}
                    className={`px-3 py-2 rounded-full text-sm ${theme === 'system' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                  >
                    ⚙️ System
                  </button>
                </div>
              </section>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}