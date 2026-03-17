/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useContext, useRef } from "react";
import AuthContext from "./authContext";
import { socket } from "./socket";
import axios from "axios";
import EmojiPicker from "emoji-picker-react";
import { FaSignOutAlt, FaVideo, FaSmile, FaArrowLeft, FaImage, FaPaperPlane, FaPhone, FaPhoneSlash, FaTrash, FaTimes, FaCamera, FaMicrophone, FaStop, FaUserPlus, FaUsers } from "react-icons/fa";
import { BiCheckDouble, BiCheck } from "react-icons/bi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useNavigate } from "react-router-dom";
import "./css/chat.css";

import ringingSound from "../assets/audio/ring.mp3";
import callingSound from "../assets/audio/calling.mp3";
import notificationSound from "../assets/audio/notification.mp3";

const APIURL = `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api`;
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

const generateTempId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);

const formatTime = (d) => {
    if (!d) return "";
    return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDateDivider = (d) => {
    if (!d) return "";
    const date = new Date(d), now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (date >= today) return "Today";
    if (date >= yesterday) return "Yesterday";
    return date.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
};

const isSameDay = (d1, d2) => {
    const a = new Date(d1), b = new Date(d2);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};

const getInitial = (name) => name?.charAt(0)?.toUpperCase() || "?";

// Avatar component — shows image if available, else initial
const Avatar = ({ user, size = "md", className = "" }) => {
    const sizeClass = size === "sm" ? "avatar-sm" : size === "xs" ? "avatar-xs" : "";
    if (user?.avatar) {
        return (
            <img
                src={`${BASE}${user.avatar}`}
                alt={user.username}
                className={`avatar avatar-img ${sizeClass} ${className}`}
            />
        );
    }
    return (
        <div className={`avatar ${sizeClass} ${className}`}>
            {getInitial(user?.username)}
        </div>
    );
};

const Chat = () => {
    const { setUser } = useContext(AuthContext);
    const [message, setMessage] = useState("");
    const [messages, setMessages] = useState([]);
    const [receiverId, setReceiverId] = useState(() => localStorage.getItem("lastReceiverId") || "");
    const [receiverName, setReceiverName] = useState(() => localStorage.getItem("lastReceiverName") || "");
    const [receiverUser, setReceiverUser] = useState(null);
    const [onlineUsers, setOnlineUsers] = useState([]);
    const [userProfile, setUserProfile] = useState({});
    const [allUsers, setAllUsers] = useState([]);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showSidebar, setShowSidebar] = useState(true);
    const [videoCallData, setVideoCallData] = useState(null);
    const [isCalling, setIsCalling] = useState(false);
    const [imagePreview, setImagePreview] = useState(null);
    const [imageFile, setImageFile] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordingTimerRef = useRef(null);

    const [fetchKey, setFetchKey] = useState(0);
    const [showPeople, setShowPeople] = useState(false);

    // Message selection
    const [selectedMsgs, setSelectedMsgs] = useState(new Set());
    const [selectMode, setSelectMode] = useState(false);

    const chatRef = useRef(null);
    const imageInputRef = useRef(null);
    const avatarInputRef = useRef(null);
    const navigate = useNavigate();
    const callingAudio = useRef(new Audio(callingSound));
    const ringingAudio = useRef(new Audio(ringingSound));
    const requestAudio = useRef(new Audio(notificationSound));

    // Auth + restore last chat
    useEffect(() => {
        const token = localStorage.getItem("token");
        if (!token) { navigate("/"); return; }
        axios.get(`${APIURL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
            .then(res => setUserProfile(res.data))
            .catch(() => navigate("/"));
    }, []);

    // Real-time: new user registered
    useEffect(() => {
        const handleNewUser = (u) => setAllUsers(prev => prev.find(x => x._id === u._id) ? prev : [...prev, u]);
        socket.on("new-user", handleNewUser);
        return () => socket.off("new-user", handleNewUser);
    }, []);

    // Real-time: incoming friend request
    useEffect(() => {
        if (!userProfile._id) return;
        const handleFriendRequest = ({ from }) => {
            setAllUsers(prev => prev.map(u => u._id === from ? { ...u, sentMeRequest: true } : u));
            requestAudio.current.currentTime = 0;
            requestAudio.current.play().catch(() => {});
            toast.info("You have a new friend request!");
        };
        const handleFriendAccepted = ({ by, user: newFriend }) => {
            setAllUsers(prev => prev.map(u => u._id === by ? { ...u, ...newFriend } : u));
            setUserProfile(prev => ({ ...prev, friends: [...(prev.friends || []), by] }));
            toast.success(`${newFriend.username} accepted your friend request!`);
        };
        const handleUnfriended = ({ by }) => {
            setUserProfile(prev => ({ ...prev, friends: (prev.friends || []).filter(id => String(id) !== String(by)) }));
            setAllUsers(prev => prev.map(u => u._id === by ? { ...u, pendingRequest: false } : u));
            toast.info("A friend removed you.");
        };
        socket.on("friend-request", handleFriendRequest);
        socket.on("friend-accepted", handleFriendAccepted);
        socket.on("unfriended", handleUnfriended);
        return () => {
            socket.off("friend-request", handleFriendRequest);
            socket.off("friend-accepted", handleFriendAccepted);
            socket.off("unfriended", handleUnfriended);
        };
    }, [userProfile._id]);

    // Socket: online status, calls, read receipts
    useEffect(() => {
        if (!userProfile._id) return;
        socket.emit("user-online", userProfile._id);

        socket.on("update-user-status", (onlineList) => setOnlineUsers(onlineList));

        socket.on("call-invitation", ({ from, name }) => {
            setVideoCallData({ callerId: from, callerName: name });
            ringingAudio.current.loop = true;
            ringingAudio.current.play().catch(() => {});
        });

        socket.on("call-accepted", () => {
            setIsCalling(false);
            callingAudio.current.pause();
            callingAudio.current.currentTime = 0;
            toast.dismiss("calling");
            navigate(`/video/${receiverId}?role=caller`);
        });

        socket.on("call-rejected", () => {
            setIsCalling(false);
            callingAudio.current.pause();
            callingAudio.current.currentTime = 0;
            toast.dismiss("calling");
            toast.error(`${receiverName || "User"} rejected the call.`);
        });

        socket.on("messageRead", (updatedMsg) => {
            setMessages(prev => prev.map(m => m._id === updatedMsg._id ? { ...m, read: true } : m));
        });

        socket.on("messagesDeleted", ({ messageIds }) => {
            setMessages(prev => prev.filter(m => !messageIds.includes(m._id)));
        });

        return () => {
            socket.off("update-user-status");
            socket.off("call-invitation");
            socket.off("call-accepted");
            socket.off("call-rejected");
            socket.off("messageRead");
            socket.off("messagesDeleted");
            callingAudio.current.pause();
            ringingAudio.current.pause();
        };
    }, [userProfile, receiverId]);

    // Fetch messages + receive new ones
    useEffect(() => {
        if (!userProfile._id || !receiverId) return;
        const myId = userProfile._id;
        setMessages([]);

        axios.get(`${APIURL}/chat/messages/${receiverId}?userId=${myId}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }).then(res => setMessages(res.data)).catch(() => setMessages([]));

        const handleReceive = (data) => {
            const isRelevant = (
                (data.sender === receiverId && data.receiver === myId) ||
                (data.sender === myId && data.receiver === receiverId)
            );
            if (!isRelevant) return;
            setMessages(prev => {
                if (prev.find(m => m._id === data._id)) return prev;
                return [...prev, data];
            });
            if (data.sender === receiverId && data.receiver === myId) {
                socket.emit("markRead", { messageId: data._id, senderId: data.sender });
            }
        };

        socket.on("receiveMessage", handleReceive);
        return () => socket.off("receiveMessage", handleReceive);
    }, [userProfile._id, receiverId, fetchKey]);

    // Mark unread as read on open
    useEffect(() => {
        if (!userProfile._id || !receiverId || messages.length === 0) return;
        messages.forEach(msg => {
            if (msg.sender === receiverId && msg.receiver === userProfile._id && !msg.read) {
                socket.emit("markRead", { messageId: msg._id, senderId: msg.sender });
            }
        });
    }, [receiverId, messages.length]);

    // Fetch all users
    useEffect(() => {
        if (!userProfile._id) return;
        axios.get(`${APIURL}/auth/users`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }).then(res => {
            // Mark users who sent me a request
            const withFlags = res.data.map(u => ({
                ...u,
                sentMeRequest: (userProfile.friendRequests || []).map(String).includes(String(u._id))
            }));
            setAllUsers(withFlags);
            const savedId = localStorage.getItem("lastReceiverId");
            if (savedId) {
                const found = withFlags.find(u => u._id === savedId);
                if (found) setReceiverUser(found);
            }
        }).catch(() => {});
    }, [userProfile._id]);

    const isFriend = (uid) => (userProfile.friends || []).map(String).includes(String(uid));
    const hasSentRequest = (uid) => (allUsers.find(u => u._id === uid)?.friendRequests || []).map(String).includes(String(userProfile._id));

    const sendFriendRequest = async (toId) => {
        try {
            await axios.post(`${APIURL}/auth/friend-request`, { toId }, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            // Mark locally as pending
            setAllUsers(prev => prev.map(u => u._id === toId ? { ...u, pendingRequest: true } : u));
            toast.success("Friend request sent!");
        } catch (e) {
            toast.error(e.response?.data?.message || "Failed to send request");
        }
    };

    const acceptFriendRequest = async (fromId) => {
        try {
            const res = await axios.post(`${APIURL}/auth/friend-accept`, { fromId }, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            setUserProfile(prev => ({
                ...prev,
                friends: [...(prev.friends || []), fromId],
                friendRequests: (prev.friendRequests || []).filter(id => String(id) !== String(fromId))
            }));
            setAllUsers(prev => prev.map(u => u._id === fromId ? { ...u, ...res.data.user, sentMeRequest: false } : u));
            toast.success("Friend added!");
        } catch {
            toast.error("Failed to accept request");
        }
    };

    const rejectFriendRequest = async (fromId) => {
        try {
            await axios.post(`${APIURL}/auth/friend-reject`, { fromId }, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            setUserProfile(prev => ({
                ...prev,
                friendRequests: (prev.friendRequests || []).filter(id => String(id) !== String(fromId))
            }));
            setAllUsers(prev => prev.map(u => u._id === fromId ? { ...u, sentMeRequest: false } : u));
        } catch {
            toast.error("Failed to reject request");
        }
    };

    const unfriend = async (friendId) => {
        try {
            await axios.post(`${APIURL}/auth/unfriend`, { friendId }, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            setUserProfile(prev => ({ ...prev, friends: (prev.friends || []).filter(id => String(id) !== String(friendId)) }));
            if (receiverId === friendId) handleBackClick();
            toast.success("Unfriended.");
        } catch {
            toast.error("Failed to unfriend.");
        }
    };

    // Responsive sidebar
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth > 768) setShowSidebar(true);
            else setShowSidebar(!receiverId);
        };
        window.addEventListener("resize", handleResize);
        handleResize();
        return () => window.removeEventListener("resize", handleResize);
    }, [receiverId]);

    // Auto scroll
    useEffect(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, [messages]);

    // Exit select mode when switching chats
    useEffect(() => {
        setSelectMode(false);
        setSelectedMsgs(new Set());
    }, [receiverId]);

    const handleSelectChat = (u) => {
        localStorage.setItem("lastReceiverId", u._id);
        localStorage.setItem("lastReceiverName", u.username);
        setReceiverUser(u);
        setReceiverName(u.username);
        setReceiverId(u._id);
        setFetchKey(k => k + 1);
        if (window.innerWidth <= 768) setShowSidebar(false);
    };

    const handleBackClick = () => {
        setShowSidebar(true);
        setReceiverId("");
        setReceiverName("");
        setReceiverUser(null);
        setMessages([]);
        setSelectMode(false);
        setSelectedMsgs(new Set());
        localStorage.removeItem("lastReceiverId");
        localStorage.removeItem("lastReceiverName");
    };

    // ── Avatar upload ──
    const handleAvatarChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = "";
        const formData = new FormData();
        formData.append("avatar", file);
        try {
            const res = await axios.put(`${APIURL}/auth/avatar`, formData, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            setUserProfile(res.data);
            toast.success("Profile photo updated!");
        } catch {
            toast.error("Failed to update profile photo.");
        }
    };

    // ── Message selection ──
    const toggleSelectMsg = (id) => {
        setSelectedMsgs(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleMsgClick = (msg) => {
        if (longPressFired.current) { longPressFired.current = false; return; }
        if (!selectMode) return;
        toggleSelectMsg(msg._id);
    };

    const handleMsgLongPress = (msg) => {
        if (msg.type === "call") return;
        setSelectMode(true);
        setSelectedMsgs(new Set([msg._id]));
    };

    const cancelSelect = () => {
        setSelectMode(false);
        setSelectedMsgs(new Set());
    };

    const deleteSelected = async () => {
        const ids = [...selectedMsgs];
        if (!ids.length) return;
        try {
            await axios.post(`${APIURL}/chat/delete-many`,
                { messageIds: ids },
                { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
            );
            setMessages(prev => prev.filter(m => !ids.includes(m._id)));
            socket.emit("deleteMessages", { messageIds: ids, receiverId });
            cancelSelect();
        } catch {
            toast.error("Failed to delete messages.");
        }
    };

    // ── Send text ──
    const sendMessage = async () => {
        if (imageFile) { await sendImage(); return; }
        if (!message.trim() || !receiverId) return;

        const tempId = generateTempId();
        const data = { sender: userProfile._id, receiver: receiverId, content: message.trim(), type: "text", createdAt: new Date().toISOString() };
        setMessages(prev => [...prev, { ...data, _id: tempId }]);
        setMessage("");
        setShowEmojiPicker(false);

        try {
            const res = await axios.post(`${APIURL}/chat/send`, data, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            setMessages(prev => prev.map(m => m._id === tempId ? res.data : m));
            socket.emit("sendMessage", res.data);
        } catch {
            toast.error("Failed to send message");
            setMessages(prev => prev.filter(m => m._id !== tempId));
        }
    };

    // ── Send image ──
    const sendImage = async () => {
        if (!imageFile || !receiverId) return;
        const formData = new FormData();
        formData.append("image", imageFile);
        const tempId = generateTempId();
        setMessages(prev => [...prev, { _id: tempId, sender: userProfile._id, receiver: receiverId, content: imagePreview, type: "image", createdAt: new Date().toISOString() }]);
        setImagePreview(null);
        setImageFile(null);
        try {
            const uploadRes = await axios.post(`${APIURL}/chat/upload`, formData, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            const imageUrl = `${BASE}${uploadRes.data.url}`;
            const res = await axios.post(`${APIURL}/chat/send`,
                { sender: userProfile._id, receiver: receiverId, content: imageUrl, type: "image" },
                { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
            );
            setMessages(prev => prev.map(m => m._id === tempId ? res.data : m));
            socket.emit("sendMessage", res.data);
        } catch {
            toast.error("Failed to send image");
            setMessages(prev => prev.filter(m => m._id !== tempId));
        }
    };

    const handleImageSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setImageFile(file);
        const reader = new FileReader();
        reader.onload = (ev) => setImagePreview(ev.target.result);
        reader.readAsDataURL(file);
        e.target.value = "";
    };

    // ── Voice recording ──
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
            mediaRecorder.start();
            setIsRecording(true);
            setRecordingTime(0);
            recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
        } catch {
            toast.error("Microphone access denied.");
        }
    };

    const stopRecording = async () => {
        if (!mediaRecorderRef.current || !isRecording) return;
        clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingTime(0);
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        mediaRecorderRef.current.onstop = async () => {
            const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
            if (blob.size < 1000) return; // too short, ignore
            const formData = new FormData();
            formData.append("voice", blob, "voice.webm");
            const tempId = generateTempId();
            const tempUrl = URL.createObjectURL(blob);
            setMessages(prev => [...prev, { _id: tempId, sender: userProfile._id, receiver: receiverId, content: tempUrl, type: "voice", createdAt: new Date().toISOString() }]);
            try {
                const uploadRes = await axios.post(`${APIURL}/chat/upload-voice`, formData, {
                    headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
                });
                const voiceUrl = `${BASE}${uploadRes.data.url}`;
                const res = await axios.post(`${APIURL}/chat/send`,
                    { sender: userProfile._id, receiver: receiverId, content: voiceUrl, type: "voice" },
                    { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
                );
                setMessages(prev => prev.map(m => m._id === tempId ? res.data : m));
                socket.emit("sendMessage", res.data);
            } catch {
                toast.error("Failed to send voice message.");
                setMessages(prev => prev.filter(m => m._id !== tempId));
            }
        };
    };

    const formatRecordingTime = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

    // ── Video call ──
    const handleVideoCall = () => {
        if (!receiverId) return;
        setIsCalling(true);
        callingAudio.current.loop = true;
        callingAudio.current.play().catch(() => {});
        socket.emit("call-invitation", { to: receiverId, from: userProfile._id, name: userProfile.username });
        toast.info(`Calling ${receiverName}...`, { autoClose: false, closeButton: false, toastId: "calling" });
    };

    const acceptCall = () => {
        ringingAudio.current.pause();
        ringingAudio.current.currentTime = 0;
        socket.emit("call-accepted", { to: videoCallData.callerId });
        navigate(`/video/${videoCallData.callerId}?role=receiver`);
        setVideoCallData(null);
        toast.dismiss();
    };

    const saveCallMessage = async (toId, content) => {
        try {
            const res = await axios.post(`${APIURL}/chat/send`,
                { sender: userProfile._id, receiver: toId, content, type: "call" },
                { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
            );
            // Add to local state directly (don't emit — avoids double on sender side)
            setMessages(prev => {
                // prevent duplicate if already added
                if (prev.find(m => m._id === res.data._id)) return prev;
                return [...prev, res.data];
            });
            // Emit only to notify the OTHER user
            socket.emit("sendMessage", res.data);
        } catch { }
    };

    const rejectCall = () => {
        ringingAudio.current.pause();
        ringingAudio.current.currentTime = 0;
        socket.emit("call-rejected", { to: videoCallData.callerId });
        saveCallMessage(videoCallData.callerId, "📵 Missed video call");
        setVideoCallData(null);
        toast.dismiss();
    };

    const handleLogout = () => {
        localStorage.clear();
        setUser(null);
        navigate("/");
    };

    const isOnline = (id) => onlineUsers.includes(id);

    // Long press support
    const longPressTimer = useRef(null);
    const longPressFired = useRef(false);

    // Stop recording on mouse/touch release anywhere
    useEffect(() => {
        const stop = () => { if (isRecording) stopRecording(); };
        window.addEventListener("mouseup", stop);
        window.addEventListener("touchend", stop);
        return () => {
            window.removeEventListener("mouseup", stop);
            window.removeEventListener("touchend", stop);
        };
    }, [isRecording]);
    const onPointerDown = (msg) => {
        if (msg.type === "call") return;
        longPressFired.current = false;
        longPressTimer.current = setTimeout(() => {
            longPressFired.current = true;
            handleMsgLongPress(msg);
        }, 500);
    };
    const onPointerUp = () => clearTimeout(longPressTimer.current);

    return (
        <div className="app-container">
            <ToastContainer position="top-right" theme="dark" />

            {/* Incoming Call Modal */}
            {videoCallData && (
                <div className="call-modal-overlay">
                    <div className="call-modal">
                        <div className="call-modal-avatar">{getInitial(videoCallData.callerName)}</div>
                        <h3>{videoCallData.callerName}</h3>
                        <p>Incoming video call...</p>
                        <div className="call-modal-actions">
                            <button className="call-btn accept" onClick={acceptCall}><FaPhone /></button>
                            <button className="call-btn reject" onClick={rejectCall}><FaPhoneSlash /></button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sidebar */}
            <aside className={`sidebar ${!showSidebar ? "sidebar-hidden" : ""}`}>
                <div className="sidebar-header">
                    <div className="sidebar-profile">
                        <div className="profile-avatar-wrap" onClick={() => avatarInputRef.current.click()} title="Change profile photo">
                            <Avatar user={userProfile} size="sm" />
                            <div className="profile-avatar-overlay"><FaCamera /></div>
                        </div>
                        <input type="file" accept="image/*" ref={avatarInputRef} style={{ display: "none" }} onChange={handleAvatarChange} />
                        <span className="sidebar-username">{userProfile.username}</span>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                        <button className="icon-btn-flat" onClick={() => setShowPeople(p => !p)} title="Add People" style={{ position: "relative" }}>
                            <FaUserPlus />
                            {allUsers.filter(u => u.sentMeRequest).length > 0 && (
                                <span className="req-notif-badge">{allUsers.filter(u => u.sentMeRequest).length}</span>
                            )}
                        </button>
                        <button className="icon-btn-flat" onClick={handleLogout} title="Logout">
                            <FaSignOutAlt />
                        </button>
                    </div>
                </div>

                {/* Add People / Friend Requests Panel */}
                {showPeople && (
                    <div className="people-panel">
                        <div className="people-panel-title"><FaUsers /> People</div>
                        {allUsers.filter(u => !isFriend(u._id)).map(u => (
                            <div key={u._id} className="people-item">
                                <div className="contact-avatar-wrap">
                                    <Avatar user={u} size="sm" />
                                    {isOnline(u._id) && <span className="online-badge" />}
                                </div>
                                <span className="people-name">{u.username}</span>
                                {u.sentMeRequest ? (
                                    <div className="people-actions">
                                        <button className="req-btn req-accept" onClick={() => acceptFriendRequest(u._id)}>Accept</button>
                                        <button className="req-btn req-reject" onClick={() => rejectFriendRequest(u._id)}>Reject</button>
                                    </div>
                                ) : u.pendingRequest ? (
                                    <span className="req-pending">Pending</span>
                                ) : (
                                    <button className="req-btn req-add" onClick={() => sendFriendRequest(u._id)}><FaUserPlus /></button>
                                )}
                            </div>
                        ))}
                        {allUsers.filter(u => !isFriend(u._id)).length === 0 && (
                            <p className="people-empty">No new people to add</p>
                        )}
                    </div>
                )}

                <div className="contact-list">
                    {allUsers.filter(u => isFriend(u._id)).map(u => {
                        const unread = messages.filter(m => m.sender === u._id && !m.read).length;
                        const lastMsg = messages.filter(m => m.sender === u._id || m.receiver === u._id).slice(-1)[0];
                        return (
                            <div
                                key={u._id}
                                className={`contact-item ${receiverId === u._id ? "active" : ""}`}
                                onClick={() => handleSelectChat(u)}
                            >
                                <div className="contact-avatar-wrap">
                                    <Avatar user={u} />
                                    {isOnline(u._id) && <span className="online-badge" />}
                                </div>
                                <div className="contact-info">
                                    <div className="contact-top">
                                        <span className="contact-name">{u.username}</span>
                                        {lastMsg && <span className="contact-time">{formatTime(lastMsg.createdAt)}</span>}
                                    </div>
                                    <div className="contact-bottom">
                                        <span className="contact-preview">
                                            {lastMsg ? (lastMsg.type === "image" ? "📷 Photo" : lastMsg.type === "call" ? "📹 Video call" : lastMsg.content) : "No messages yet"}
                                        </span>
                                        {unread > 0 && <span className="unread-badge">{unread}</span>}
                                    </div>
                                </div>
                                <button className="unfriend-btn" title="Unfriend" onClick={e => { e.stopPropagation(); unfriend(u._id); }}>✕</button>
                            </div>
                        );
                    })}
                    {allUsers.filter(u => isFriend(u._id)).length === 0 && !showPeople && (
                        <div className="no-friends-hint">
                            <p>No friends yet.</p>
                            <button className="req-btn req-add" onClick={() => setShowPeople(true)}><FaUserPlus /> Add People</button>
                        </div>
                    )}
                </div>
            </aside>

            {/* Main Chat */}
            <main className={`chat-main ${showSidebar && window.innerWidth <= 768 ? "chat-hidden" : ""}`}>
                {!receiverId ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">💬</div>
                        <h2>YashApp</h2>
                        <p>Select a conversation to start chatting</p>
                    </div>
                ) : (
                    <>
                        {/* Chat Header */}
                        <div className="chat-header">
                            <div className="chat-header-left">
                                {window.innerWidth <= 768 && (
                                    <button className="icon-btn-flat back-btn" onClick={handleBackClick}>
                                        <FaArrowLeft />
                                    </button>
                                )}
                                <div className="contact-avatar-wrap">
                                    <Avatar user={receiverUser || { username: receiverName }} />
                                    {isOnline(receiverId) && <span className="online-badge" />}
                                </div>
                                <div className="chat-header-info">
                                    <span className="chat-header-name">{receiverName}</span>
                                    <span className={`chat-header-status ${isOnline(receiverId) ? "status-online" : "status-offline"}`}>
                                        {isOnline(receiverId) ? "Online" : "Offline"}
                                    </span>
                                </div>
                            </div>
                            <div className="chat-header-right">
                                {selectMode ? (
                                    <>
                                        <span className="select-count">{selectedMsgs.size} selected</span>
                                        <button className="icon-btn-flat delete-btn" onClick={deleteSelected} disabled={selectedMsgs.size === 0} title="Delete selected">
                                            <FaTrash />
                                        </button>
                                        <button className="icon-btn-flat" onClick={cancelSelect} title="Cancel">
                                            <FaTimes />
                                        </button>
                                    </>
                                ) : (
                                    <button className="icon-btn-flat video-btn" onClick={handleVideoCall} title="Video Call">
                                        <FaVideo />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Messages */}
                        <div className={`chat-body${selectMode ? " select-mode" : ""}`} ref={chatRef} style={selectMode ? { userSelect: 'none' } : {}}>
                            {messages.length === 0 && (
                                <div className="no-messages"><p>No messages yet. Say hello! 👋</p></div>
                            )}
                            {messages.map((msg, i) => {
                                const isMine = msg.sender === userProfile._id;
                                const showDivider = i === 0 || !isSameDay(messages[i - 1].createdAt, msg.createdAt);
                                const isSelected = selectedMsgs.has(msg._id);

                                if (msg.type === "call") {
                                    const isMineCall = msg.sender === userProfile._id;
                                    const isMissed = msg.content.includes("Missed") || msg.content.includes("📵");
                                    const isEnded = msg.content.includes("ended");
                                    const icon = isMissed ? "📵" : "💹";
                                    const label = isMissed
                                        ? (isMineCall ? "No answer" : "Missed call")
                                        : msg.content.replace("💹 ", "").replace("📵 ", "");
                                    return (
                                        <div key={msg._id || i}>
                                            {showDivider && <div className="date-divider"><span>{formatDateDivider(msg.createdAt)}</span></div>}
                                            <div className={`call-event-msg ${isMineCall ? "call-event-mine" : "call-event-theirs"}`}>
                                                <span className="call-event-icon">{icon}</span>
                                                <span className="call-event-text">{label}</span>
                                                <span className="call-event-time">{formatTime(msg.createdAt)}</span>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={msg._id || i}>
                                        {showDivider && <div className="date-divider"><span>{formatDateDivider(msg.createdAt)}</span></div>}
                                        <div
                                            className={`msg-row ${isMine ? "msg-mine" : "msg-theirs"} ${isSelected ? "msg-selected" : ""}`}
                                            onClick={() => handleMsgClick(msg)}
                                            onPointerDown={() => onPointerDown(msg)}
                                            onPointerUp={onPointerUp}
                                            onPointerLeave={onPointerUp}
                                        >
                                            {selectMode && (
                                                <div className={`msg-checkbox ${isSelected ? "checked" : ""}`}>
                                                    {isSelected && <span>✓</span>}
                                                </div>
                                            )}
                                            {!isMine && <Avatar user={receiverUser || { username: receiverName }} size="xs" />}
                                            <div className={`msg-bubble ${isMine ? "bubble-mine" : "bubble-theirs"}${msg.type === "image" ? " img-bubble" : ""}`}>
                                                {msg.type === "image" ? (
                                                    <div className="msg-image-wrap">
                                                        <img src={msg.content} alt="sent" className="msg-image"
                                                            onClick={(e) => { if (!selectMode) { e.stopPropagation(); window.open(msg.content, "_blank"); } }} />
                                                        <div className="img-meta-overlay">
                                                            <span className="msg-time">{formatTime(msg.createdAt)}</span>
                                                            {isMine && (msg.read ? <BiCheckDouble className="tick tick-read" /> : <BiCheck className="tick tick-sent" />)}
                                                        </div>
                                                    </div>
                                                ) : msg.type === "voice" ? (
                                                    <div className="voice-bubble">
                                                        <FaMicrophone className="voice-icon" />
                                                        <audio controls src={msg.content} className="voice-audio" />
                                                        <div className="msg-meta">
                                                            <span className="msg-time">{formatTime(msg.createdAt)}</span>
                                                            {isMine && (msg.read ? <BiCheckDouble className="tick tick-read" /> : <BiCheck className="tick tick-sent" />)}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <p className="msg-text">{msg.content}</p>
                                                        <div className="msg-meta">
                                                            <span className="msg-time">{formatTime(msg.createdAt)}</span>
                                                            {isMine && (msg.read ? <BiCheckDouble className="tick tick-read" /> : <BiCheck className="tick tick-sent" />)}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Image Preview */}
                        {imagePreview && (
                            <div className="image-preview-bar">
                                <img src={imagePreview} alt="preview" className="preview-thumb" />
                                <span className="preview-name">{imageFile?.name}</span>
                                <button className="preview-cancel" onClick={() => { setImagePreview(null); setImageFile(null); }}>✕</button>
                            </div>
                        )}

                        {/* Input Area */}
                        {!selectMode && (
                            <div className="chat-input-area">
                                {showEmojiPicker && (
                                    <div className="emoji-picker-wrap">
                                        <EmojiPicker onEmojiClick={(e) => setMessage(prev => prev + e.emoji)} theme="dark" height={350} width={300} />
                                    </div>
                                )}

                                {isRecording ? (
                                    <>
                                        <div className="recording-indicator">
                                            <span className="rec-dot" />
                                            <span className="rec-time">{formatRecordingTime(recordingTime)}</span>
                                        </div>
                                        <button className="send-btn send-active" onClick={stopRecording} title="Stop & Send">
                                            <FaStop />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button className="icon-btn-flat" onClick={() => setShowEmojiPicker(p => !p)}><FaSmile /></button>
                                        <button className="icon-btn-flat" onClick={() => imageInputRef.current.click()}><FaImage /></button>
                                        <input type="file" accept="image/*" ref={imageInputRef} style={{ display: "none" }} onChange={handleImageSelect} />
                                        <input
                                            className="msg-input"
                                            value={message}
                                            onChange={e => setMessage(e.target.value)}
                                            onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                                            placeholder="Type a message..."
                                            disabled={!!imageFile}
                                        />
                                        {(message.trim() || imageFile) ? (
                                            <button className="send-btn send-active" onClick={sendMessage}>
                                                <FaPaperPlane />
                                            </button>
                                        ) : (
                                            <button className="send-btn send-active mic-btn" onMouseDown={startRecording} onTouchStart={startRecording} title="Hold to record">
                                                <FaMicrophone />
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
};

export default Chat;
