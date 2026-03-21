/* eslint-disable no-empty */
/* eslint-disable no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useContext, useRef } from "react";
import AuthContext from "./authContext";
import { socket } from "./socket";
import axios from "axios";
import EmojiPicker from "emoji-picker-react";
import { FaSignOutAlt, FaVideo, FaSmile, FaArrowLeft, FaImage, FaPaperPlane, FaPhone, FaPhoneSlash, FaTrash, FaTimes, FaCamera, FaMicrophone, FaStop, FaUserPlus, FaUsers, FaCircle, FaFilm, FaEllipsisV, FaRegCircle, FaCommentDots } from "react-icons/fa";
import { BiCheckDouble, BiCheck } from "react-icons/bi";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useNavigate } from "react-router-dom";
import "./css/chat.css";
import StatusPanel from "./StatusPanel";
import { ShimmerCircularImage, ShimmerText } from "react-shimmer-effects";

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
        const src = user.avatar.startsWith("http") ? user.avatar : `${BASE}${user.avatar}`;
        return (
            <img
                src={src}
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

const sanitize = (text) => text.replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();

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
    const [audioCallData, setAudioCallData] = useState(null);
    const [isCalling, setIsCalling] = useState(false);
    const [isAudioCalling, setIsAudioCalling] = useState(false);
    const [imagePreview, setImagePreview] = useState(null);
    const [imageFile, setImageFile] = useState(null);
    const [mediaFiles, setMediaFiles] = useState([]); // [{file, preview, type}]
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordingTimerRef = useRef(null);

    const [fetchKey, setFetchKey] = useState(0);
    const [usersLoading, setUsersLoading] = useState(true);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [peopleSearch, setPeopleSearch] = useState("");
    const [friendSearch, setFriendSearch] = useState("");
    const [activeTab, setActiveTab] = useState("chats");
    const [allCallLogs, setAllCallLogs] = useState([]);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [profileEditMode, setProfileEditMode] = useState(false);
    const [profileDob, setProfileDob] = useState("");
    const [profileTitle, setProfileTitle] = useState("");
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [capturedPhoto, setCapturedPhoto] = useState(null);
    const [capturedFile, setCapturedFile] = useState(null);
    const [showCameraModal, setShowCameraModal] = useState(false);
    const [cameraStream, setCameraStream] = useState(null);
    const cameraInputRef = useRef(null);
    const videoPreviewRef = useRef(null);
    const canvasRef = useRef(null);

    // Message selection
    const [selectedMsgs, setSelectedMsgs] = useState(new Set());
    const [selectMode, setSelectMode] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showChatMenu, setShowChatMenu] = useState(false);
    const [deleteSheet, setDeleteSheet] = useState(null); // { msg } or null

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
            .then(res => {
                setUserProfile(res.data);
                localStorage.setItem("myUserId", res.data._id);
            })
            .catch(err => {
                // Only logout on 401 (token invalid/expired), not on network errors
                if (err.response?.status === 401) {
                    localStorage.clear();
                    navigate("/");
                }
            });
    }, []);

    // Real-time: new user registered / user updated
    useEffect(() => {
        const handleNewUser = (u) => setAllUsers(prev => prev.find(x => x._id === u._id) ? prev : [...prev, u]);
        const handleUserUpdated = (u) => {
            setAllUsers(prev => prev.map(x => x._id === u._id ? { ...x, ...u } : x));
            setReceiverUser(prev => prev?._id === u._id ? { ...prev, ...u } : prev);
        };
        socket.on("new-user", handleNewUser);
        socket.on("user-updated", handleUserUpdated);
        return () => {
            socket.off("new-user", handleNewUser);
            socket.off("user-updated", handleUserUpdated);
        };
    }, []);

    // Real-time: incoming friend request
    useEffect(() => {
        if (!userProfile._id) return;
        const handleFriendRequest = ({ from }) => {
            setAllUsers(prev => prev.map(u => u._id === from ? { ...u, sentMeRequest: true } : u));
            requestAudio.current.currentTime = 0;
            requestAudio.current.play().catch(() => { });
            toast.info("You have a new friend request!");
        };
        const handleFriendAccepted = ({ by, user: newFriend }) => {
            setAllUsers(prev => prev.map(u => u._id === by ? { ...u, ...newFriend } : u));
            setUserProfile(prev => ({ ...prev, friends: [...(prev.friends || []), by] }));
            toast.success(`${newFriend.username} accepted your friend request!`);
            setActiveTab("chats");
        };
        const handleUnfriended = ({ by }) => {
            setUserProfile(prev => ({ ...prev, friends: (prev.friends || []).filter(id => String(id) !== String(by)) }));
            setAllUsers(prev => prev.map(u => u._id === by ? { ...u, pendingRequest: false } : u));
            toast.info("A friend removed you.");
        };
        socket.on("friend-request", handleFriendRequest);
        socket.on("friend-accepted", handleFriendAccepted);
        const handleBlockedBy = ({ by }) => {
            setAllUsers(prev => prev.map(u => u._id === by ? { ...u, blockedUsers: [...(u.blockedUsers || []), userProfile._id] } : u));
        };
        const handleUnblockedBy = ({ by }) => {
            setAllUsers(prev => prev.map(u => u._id === by ? { ...u, blockedUsers: (u.blockedUsers || []).filter(id => String(id) !== String(userProfile._id)) } : u));
        };
        socket.on("unfriended", handleUnfriended);
        socket.on("blocked-by", handleBlockedBy);
        socket.on("unblocked-by", handleUnblockedBy);
        return () => {
            socket.off("friend-request", handleFriendRequest);
            socket.off("friend-accepted", handleFriendAccepted);
            socket.off("unfriended", handleUnfriended);
            socket.off("blocked-by", handleBlockedBy);
            socket.off("unblocked-by", handleUnblockedBy);
        };
    }, [userProfile._id]);

    // Socket: online status, calls, read receipts
    useEffect(() => {
        if (!userProfile._id) return;
        socket.emit("user-online", userProfile._id);

        socket.on("update-user-status", (onlineList) => setOnlineUsers(onlineList));

        socket.on("audio-call-invitation", ({ from, name }) => {
            setAudioCallData({ callerId: from, callerName: name });
            ringingAudio.current.loop = true;
            ringingAudio.current.play().catch(() => { });
        });

        socket.on("audio-call-accepted", () => {
            setIsAudioCalling(false);
            callingAudio.current.pause();
            callingAudio.current.currentTime = 0;
            navigate(`/audio/${receiverId}?role=caller&name=${encodeURIComponent(receiverName)}`);
        });

        socket.on("audio-call-rejected", () => {
            setIsAudioCalling(false);
            callingAudio.current.pause();
            callingAudio.current.currentTime = 0;
            toast.error(`${receiverName || "User"} rejected the call.`);
        });

        socket.on("call-invitation", ({ from, name }) => {
            setVideoCallData({ callerId: from, callerName: name });
            ringingAudio.current.loop = true;
            ringingAudio.current.play().catch(() => { });
        });

        socket.on("call-cancelled", () => {
            setVideoCallData(null);
            ringingAudio.current.pause();
            ringingAudio.current.currentTime = 0;
        });

        socket.on("audio-call-cancelled", () => {
            setAudioCallData(null);
            ringingAudio.current.pause();
            ringingAudio.current.currentTime = 0;
        });

        socket.on("call-accepted", () => {
            setIsCalling(false);
            callingAudio.current.pause();
            callingAudio.current.currentTime = 0;
            navigate(`/video/${receiverId}?role=caller`);
        });

        socket.on("call-rejected", () => {
            setIsCalling(false);
            callingAudio.current.pause();
            callingAudio.current.currentTime = 0;
            toast.error(`${receiverName || "User"} rejected the call.`);
        });

        socket.on("messageRead", (updatedMsg) => {
            setMessages(prev => prev.map(m => m._id === updatedMsg._id ? { ...m, read: true } : m));
        });

        socket.on("messagesDeleted", ({ messageIds }) => {
            setMessages(prev => prev.filter(m => !messageIds.includes(m._id)));
        });

        return () => {
            socket.off("audio-call-invitation");
            socket.off("audio-call-accepted");
            socket.off("audio-call-rejected");
            socket.off("audio-call-cancelled");
            socket.off("update-user-status");
            socket.off("call-invitation");
            socket.off("call-accepted");
            socket.off("call-rejected");
            socket.off("call-cancelled");
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
        setMessagesLoading(true);

        axios.get(`${APIURL}/chat/messages/${receiverId}?userId=${myId}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }).then(res => setMessages(res.data)).catch(() => setMessages([])).finally(() => setMessagesLoading(false));

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
        }).catch(() => { }).finally(() => setUsersLoading(false));
    }, [userProfile._id]);

    // Fetch call logs across all friends
    useEffect(() => {
        if (!userProfile._id || activeTab !== "calls") return;
        axios.get(`${APIURL}/chat/calls`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
            params: { userId: userProfile._id }
        }).then(res => setAllCallLogs(res.data)).catch(() => { });
    }, [userProfile._id, activeTab]);

    const isFriend = (uid) => (userProfile.friends || []).map(String).includes(String(uid));
    const hasSentRequest = (uid) => (allUsers.find(u => u._id === uid)?.friendRequests || []).map(String).includes(String(userProfile._id));
    const isBlocked = (uid) => (userProfile.blockedUsers || []).map(String).includes(String(uid));
    const isBlockedByThem = (uid) => (allUsers.find(u => u._id === uid)?.blockedUsers || []).map(String).includes(String(userProfile._id));

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
            setActiveTab("chats");
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

    const blockUser = async (blockId) => {
        try {
            await axios.post(`${APIURL}/auth/block`, { blockId }, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            setUserProfile(prev => ({ ...prev, blockedUsers: [...(prev.blockedUsers || []), blockId] }));
            if (receiverId === blockId) handleBackClick();
            toast.success("User blocked.");
        } catch { toast.error("Failed to block."); }
    };

    const unblockUser = async (unblockId) => {
        try {
            await axios.post(`${APIURL}/auth/unblock`, { unblockId }, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            setUserProfile(prev => ({ ...prev, blockedUsers: (prev.blockedUsers || []).filter(id => String(id) !== String(unblockId)) }));
            toast.success("User unblocked.");
        } catch { toast.error("Failed to unblock."); }
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

    const openProfileModal = () => {
        setProfileDob(userProfile.dob || "");
        setProfileTitle(userProfile.title || "");
        setProfileEditMode(false);
        setShowProfileModal(true);
    };

    const saveProfile = async () => {
        try {
            const res = await axios.put(`${APIURL}/auth/profile`, { dob: profileDob, title: profileTitle }, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            setUserProfile(res.data);
            setProfileEditMode(false);
            toast.success("Profile updated!");
        } catch {
            toast.error("Failed to update profile.");
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
        setDeleteSheet(null);
    };

    const withinOneHour = (createdAt) => (Date.now() - new Date(createdAt).getTime()) < 60 * 60 * 1000;

    const deleteForMe = async (ids) => {
        try {
            await axios.post(`${APIURL}/chat/delete-for-me`,
                { messageIds: ids, userId: userProfile._id },
                { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
            );
            setMessages(prev => prev.filter(m => !ids.includes(m._id)));
            setDeleteSheet(null);
            cancelSelect();
        } catch { toast.error("Failed to delete."); }
    };

    const deleteForAll = async (ids) => {
        try {
            await axios.post(`${APIURL}/chat/delete-many`,
                { messageIds: ids },
                { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
            );
            setMessages(prev => prev.filter(m => !ids.includes(m._id)));
            socket.emit("deleteMessages", { messageIds: ids, receiverId });
            setDeleteSheet(null);
            cancelSelect();
        } catch { toast.error("Failed to delete."); }
    };

    const clearChat = async () => {
        if (!window.confirm("Clear all messages? This will only clear on your side.")) return;
        const ids = messages.map(m => m._id).filter(Boolean);
        if (!ids.length) return;
        try {
            await axios.post(`${APIURL}/chat/delete-for-me`,
                { messageIds: ids, userId: userProfile._id },
                { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
            );
            setMessages([]);
            setAllCallLogs(prev => prev.filter(log => {
                const friendId = log.sender === userProfile._id ? log.receiver : log.sender;
                return friendId !== receiverId;
            }));
            setShowChatMenu(false);
            toast.success("Chat cleared.");
        } catch { toast.error("Failed to clear chat."); }
    };

    // Called when trash icon clicked in select mode
    const handleDeleteSelected = () => {
        const ids = [...selectedMsgs];
        if (!ids.length) return;
        const selectedMessages = messages.filter(m => ids.includes(m._id));
        const allMine = selectedMessages.every(m => m.sender === userProfile._id);
        const allWithinHour = selectedMessages.every(m => withinOneHour(m.createdAt));
        setDeleteSheet({ ids, allMine, allWithinHour });
    };

    // ── Send text ──
    const sendMessage = async () => {
        if (imageFile || mediaFiles.length) { await sendImage(); return; }
        if (!message.trim() || !receiverId) return;
        if (isBlocked(receiverId)) { toast.error("You have blocked this user."); return; }
        if (isBlockedByThem(receiverId)) { toast.error("You cannot send messages to this user."); return; }

        const tempId = generateTempId();
        const data = { sender: userProfile._id, receiver: receiverId, content: sanitize(message), type: "text", createdAt: new Date().toISOString() };
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

    // ── Send media (images/videos) ──
    const sendImage = async () => {
        if (!mediaFiles.length || !receiverId) return;
        if (isBlocked(receiverId)) { toast.error("You have blocked this user."); return; }
        if (isBlockedByThem(receiverId)) { toast.error("You cannot send messages to this user."); return; }
        const formData = new FormData();
        mediaFiles.forEach(m => formData.append("files", m.file));
        const tempIds = mediaFiles.map(() => generateTempId());
        mediaFiles.forEach((m, i) => {
            setMessages(prev => [...prev, { _id: tempIds[i], sender: userProfile._id, receiver: receiverId, content: m.preview, type: m.type, createdAt: new Date().toISOString() }]);
        });
        setMediaFiles([]);
        setImagePreview(null);
        setImageFile(null);
        try {
            const uploadRes = await axios.post(`${APIURL}/chat/upload`, formData, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            for (let i = 0; i < uploadRes.data.files.length; i++) {
                const { url, type } = uploadRes.data.files[i];
                const res = await axios.post(`${APIURL}/chat/send`,
                    { sender: userProfile._id, receiver: receiverId, content: url, type },
                    { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
                );
                setMessages(prev => prev.map(m => m._id === tempIds[i] ? res.data : m));
                socket.emit("sendMessage", res.data);
            }
        } catch {
            toast.error("Failed to send media");
            tempIds.forEach(id => setMessages(prev => prev.filter(m => m._id !== id)));
        }
    };

    const handleImageSelect = (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const newMedia = [];
        files.forEach(file => {
            const type = file.type.startsWith("video/") ? "video" : "image";
            const preview = URL.createObjectURL(file);
            newMedia.push({ file, preview, type });
        });
        setMediaFiles(prev => [...prev, ...newMedia].slice(0, 10));
        setImageFile(newMedia[0]?.file || null);
        setImagePreview(newMedia[0]?.preview || null);
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
        if (isBlocked(receiverId) || isBlockedByThem(receiverId)) { toast.error("Cannot call this user."); return; }
        if (!window.confirm(`Start a video call with ${receiverName}?\n\nThis app uses your camera & microphone only for this call.`)) return;
        setIsCalling(true);
        callingAudio.current.loop = true;
        callingAudio.current.play().catch(() => { });
        socket.emit("call-invitation", { to: receiverId, from: userProfile._id, name: userProfile.username });
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

    const handleAudioCall = () => {
        if (!receiverId) return;
        if (isBlocked(receiverId) || isBlockedByThem(receiverId)) { toast.error("Cannot call this user."); return; }
        if (!window.confirm(`Start an audio call with ${receiverName}?\n\nThis app uses your microphone only for this call.`)) return;
        setIsAudioCalling(true);
        callingAudio.current.loop = true;
        callingAudio.current.play().catch(() => { });
        socket.emit("audio-call-invitation", { to: receiverId, from: userProfile._id, name: userProfile.username });
    };

    const acceptAudioCall = () => {
        ringingAudio.current.pause();
        ringingAudio.current.currentTime = 0;
        socket.emit("audio-call-accepted", { to: audioCallData.callerId });
        navigate(`/audio/${audioCallData.callerId}?role=receiver&name=${encodeURIComponent(audioCallData.callerName)}`);
        setAudioCallData(null);
        toast.dismiss();
    };

    const rejectAudioCall = () => {
        ringingAudio.current.pause();
        ringingAudio.current.currentTime = 0;
        socket.emit("audio-call-rejected", { to: audioCallData.callerId });
        saveCallMessage(audioCallData.callerId, "📵 Missed audio call");
        setAudioCallData(null);
        toast.dismiss();
    };

    const cancelVideoCall = () => {
        setIsCalling(false);
        callingAudio.current.pause();
        callingAudio.current.currentTime = 0;
        socket.emit("call-cancelled", { to: receiverId });
    };

    const cancelAudioCall = () => {
        setIsAudioCalling(false);
        callingAudio.current.pause();
        callingAudio.current.currentTime = 0;
        socket.emit("audio-call-cancelled", { to: receiverId });
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

    // Close menus on outside click
    useEffect(() => {
        const close = (e) => {
            if (showMenu && !e.target.closest(".sidebar-menu-wrap")) setShowMenu(false);
            if (showAttachMenu && !e.target.closest(".attach-wrap")) setShowAttachMenu(false);
            if (showChatMenu && !e.target.closest(".chat-menu-wrap")) setShowChatMenu(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [showMenu, showAttachMenu, showChatMenu]);

    const openCamera = async () => {
        // Desktop only — mobile uses inline label input
        setCapturedPhoto(null);
        setCapturedFile(null);
        setShowCameraModal(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            setCameraStream(stream);
            setTimeout(() => {
                if (videoPreviewRef.current) videoPreviewRef.current.srcObject = stream;
            }, 100);
        } catch {
            toast.error("Camera access denied.");
            setShowCameraModal(false);
        }
    };

    const capturePhoto = () => {
        const video = videoPreviewRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        stopCameraStream();
        setCapturedPhoto(dataUrl);
        // convert dataUrl to File
        fetch(dataUrl).then(r => r.blob()).then(blob => {
            setCapturedFile(new File([blob], "camera.jpg", { type: "image/jpeg" }));
        });
    };

    const stopCameraStream = () => {
        if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); setCameraStream(null); }
    };

    // Mobile native capture handler
    const handleCameraCapture = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = "";
        setCapturedPhoto(URL.createObjectURL(file));
        setCapturedFile(file);
    };

    const sendCapturedPhoto = async (fileArg, previewArg) => {
        const file = fileArg || capturedFile;
        const preview = previewArg || capturedPhoto;
        if (!file) return;
        const toId = receiverId || localStorage.getItem("lastReceiverId");
        const myId = userProfile._id || localStorage.getItem("myUserId");
        if (!toId || !myId) { toast.error("No chat selected."); return; }
        setCapturedPhoto(null);
        setCapturedFile(null);
        setShowCameraModal(false);
        setShowAttachMenu(false);
        const tempId = generateTempId();
        setMessages(prev => [...prev, { _id: tempId, sender: myId, receiver: toId, content: preview, type: "image", createdAt: new Date().toISOString() }]);
        try {
            const formData = new FormData();
            formData.append("files", file);
            const uploadRes = await axios.post(`${APIURL}/chat/upload`, formData, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
            });
            const { url, type } = uploadRes.data.files[0];
            const res = await axios.post(`${APIURL}/chat/send`,
                { sender: myId, receiver: toId, content: url, type },
                { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
            );
            setMessages(prev => prev.map(m => m._id === tempId ? res.data : m));
            socket.emit("sendMessage", res.data);
        } catch {
            toast.error("Failed to send photo.");
            setMessages(prev => prev.filter(m => m._id !== tempId));
        }
    };

    const closeCameraModal = () => {
        stopCameraStream();
        setCapturedPhoto(null);
        setCapturedFile(null);
        setShowCameraModal(false);
    };

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

            {/* Delete Sheet */}
            {deleteSheet && (
                <div className="call-modal-overlay" onClick={() => setDeleteSheet(null)}>
                    <div className="delete-sheet" onClick={e => e.stopPropagation()}>
                        <p className="delete-sheet-title">
                            Delete {deleteSheet.ids?.length > 1 ? `${deleteSheet.ids.length} messages` : "message"}?
                        </p>
                        <button className="delete-sheet-btn" onClick={() => deleteForMe(deleteSheet.ids)}>
                            🗑 Delete for Me
                        </button>
                        {deleteSheet.allMine && deleteSheet.allWithinHour && (
                            <button className="delete-sheet-btn delete-sheet-all" onClick={() => deleteForAll(deleteSheet.ids)}>
                                🗑 Delete for All
                            </button>
                        )}
                        {deleteSheet.allMine && !deleteSheet.allWithinHour && (
                            <button className="delete-sheet-btn delete-sheet-disabled" disabled>
                                🗑 Delete for All (1hr limit expired)
                            </button>
                        )}
                        <button className="delete-sheet-btn delete-sheet-cancel" onClick={() => setDeleteSheet(null)}>Cancel</button>
                    </div>
                </div>
            )}

            {/* Incoming Audio Call Modal */}
            {audioCallData && (
                <div className="call-modal-overlay">
                    <div className="call-modal">
                        <div className="call-modal-avatar">{getInitial(audioCallData.callerName)}</div>
                        <h3>{audioCallData.callerName}</h3>
                        <p>Incoming audio call...</p>
                        <div className="call-modal-actions">
                            <button className="call-btn accept" onClick={acceptAudioCall}><FaPhone /></button>
                            <button className="call-btn reject" onClick={rejectAudioCall}><FaPhoneSlash /></button>
                        </div>
                    </div>
                </div>
            )}

            {/* Incoming Video Call Modal */}
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

            {/* Outgoing Video Call Modal */}
            {isCalling && (
                <div className="call-modal-overlay">
                    <div className="call-modal">
                        <div className="call-modal-avatar calling-pulse">{getInitial(receiverName)}</div>
                        <h3>{receiverName}</h3>
                        <p>Calling...</p>
                        <div className="call-modal-actions">
                            <button className="call-btn reject" onClick={cancelVideoCall}><FaPhoneSlash /></button>
                        </div>
                    </div>
                </div>
            )}

            {/* Outgoing Audio Call Modal */}
            {isAudioCalling && (
                <div className="call-modal-overlay">
                    <div className="call-modal">
                        <div className="call-modal-avatar calling-pulse">{getInitial(receiverName)}</div>
                        <h3>{receiverName}</h3>
                        <p>Calling...</p>
                        <div className="call-modal-actions">
                            <button className="call-btn reject" onClick={cancelAudioCall}><FaPhoneSlash /></button>
                        </div>
                    </div>
                </div>
            )}

            {/* Profile Modal */}
            {showProfileModal && (
                <div className="call-modal-overlay" onClick={() => setShowProfileModal(false)}>
                    <div className="profile-modal" onClick={e => e.stopPropagation()}>
                        <div className="profile-modal-header">
                            <span>{profileEditMode ? "Edit Profile" : "Profile"}</span>
                            <button onClick={() => setShowProfileModal(false)}><FaTimes /></button>
                        </div>

                        {/* Avatar — always clickable to change photo */}
                        <div className="profile-modal-avatar" onClick={() => avatarInputRef.current.click()}>
                            <Avatar user={userProfile} />
                            <div className="profile-modal-avatar-overlay"><FaCamera /></div>
                        </div>

                        {profileEditMode ? (
                            <>
                                <div className="profile-modal-name">{userProfile.username}</div>
                                <div className="profile-modal-field">
                                    <label>Title / Bio</label>
                                    <input
                                        className="profile-modal-input"
                                        placeholder="e.g. Developer, Student..."
                                        value={profileTitle}
                                        onChange={e => setProfileTitle(e.target.value)}
                                        maxLength={40}
                                        autoFocus
                                    />
                                </div>
                                <div className="profile-modal-field">
                                    <label>Date of Birth</label>
                                    <input
                                        type="date"
                                        className="profile-modal-input"
                                        value={profileDob}
                                        onChange={e => setProfileDob(e.target.value)}
                                    />
                                </div>
                                <div className="profile-modal-edit-actions">
                                    <button className="profile-modal-cancel" onClick={() => setProfileEditMode(false)}>Cancel</button>
                                    <button className="profile-modal-save" onClick={saveProfile}>Update</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="profile-view-name">{userProfile.username}</div>
                                <div className="profile-view-row">
                                    <span className="profile-view-label">Title</span>
                                    <span className="profile-view-value">{userProfile.title || <span className="profile-view-empty">Not set</span>}</span>
                                </div>
                                <div className="profile-view-row">
                                    <span className="profile-view-label">Date of Birth</span>
                                    <span className="profile-view-value">{userProfile.dob ? new Date(userProfile.dob).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" }) : <span className="profile-view-empty">Not set</span>}</span>
                                </div>
                                <button className="profile-modal-edit-btn" onClick={() => { setProfileDob(userProfile.dob || ""); setProfileTitle(userProfile.title || ""); setProfileEditMode(true); }}>
                                    Edit Profile
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Camera Modal — live feed (desktop) or preview (both) */}
            {showCameraModal && (
                <div className="call-modal-overlay" onClick={closeCameraModal}>
                    <div className="camera-modal" onClick={e => e.stopPropagation()}>
                        <div className="camera-modal-header">
                            <span>{capturedPhoto ? "Preview" : "Take Photo"}</span>
                            <button onClick={closeCameraModal}><FaTimes /></button>
                        </div>
                        {capturedPhoto ? (
                            <>
                                <img src={capturedPhoto} alt="captured" className="camera-preview-img" />
                                <div className="camera-modal-actions">
                                    <button className="camera-btn camera-retake" onClick={() => { setCapturedPhoto(null); setCapturedFile(null); openCamera(); }}>Retake</button>
                                    <button className="camera-btn camera-send" onClick={() => sendCapturedPhoto(capturedFile, capturedPhoto)}><FaPaperPlane /> Send</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <video ref={videoPreviewRef} autoPlay playsInline muted className="camera-live-video" />
                                <canvas ref={canvasRef} style={{ display: "none" }} />
                                <div className="camera-modal-actions">
                                    <button className="camera-btn camera-capture" onClick={capturePhoto}><FaCamera /></button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            {/* Mobile: native camera capture + preview */}
            {!showCameraModal && capturedPhoto && (
                <div className="call-modal-overlay" onClick={closeCameraModal}>
                    <div className="camera-modal" onClick={e => e.stopPropagation()}>
                        <div className="camera-modal-header">
                            <span>Preview</span>
                            <button onClick={closeCameraModal}><FaTimes /></button>
                        </div>
                        <img src={capturedPhoto} alt="captured" className="camera-preview-img" />
                        <div className="camera-modal-actions">
                            <button className="camera-btn camera-retake" onClick={() => { setCapturedPhoto(null); setCapturedFile(null); }}>Retake</button>
                            <button className="camera-btn camera-send" onClick={() => sendCapturedPhoto(capturedFile, capturedPhoto)}><FaPaperPlane /> Send</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Desktop vertical icon bar */}
            <div className="desktop-icon-bar">
                <button className={`desktop-icon-btn${activeTab === "chats" ? " dib-active" : ""}`} onClick={() => setActiveTab("chats")} title="Chats">
                    <FaCommentDots />
                </button>
                <button className={`desktop-icon-btn${activeTab === "calls" ? " dib-active" : ""}`} onClick={() => setActiveTab("calls")} title="Calls">
                    <FaPhone />
                </button>
                <button className={`desktop-icon-btn${activeTab === "status" ? " dib-active" : ""}`} onClick={() => setActiveTab("status")} title="Status">
                    <FaRegCircle />
                </button>
                <button className={`desktop-icon-btn${activeTab === "people" ? " dib-active" : ""}`} onClick={() => setActiveTab("people")} title="People" style={{ position: "relative" }}>
                    <FaUserPlus />
                    {allUsers.filter(u => u.sentMeRequest).length > 0 && (
                        <span className="req-notif-badge">{allUsers.filter(u => u.sentMeRequest).length}</span>
                    )}
                </button>
                <div className="desktop-icon-spacer" />
                {/* <button className="desktop-icon-btn desktop-icon-logout" onClick={handleLogout} title="Logout">
                    <FaSignOutAlt />
                </button> */}
            </div>

            {/* Sidebar */}
            <aside className={`sidebar ${!showSidebar ? "sidebar-hidden" : ""}`}>
                <div className="sidebar-header">
                    <div className="sidebar-profile">
                        <div className="profile-avatar-wrap" onClick={() => avatarInputRef.current.click()} title="Change profile photo">
                            <Avatar user={userProfile} size="sm" />
                            <div className="profile-avatar-overlay"><FaCamera /></div>
                        </div>
                        <input type="file" accept="image/*" ref={cameraInputRef} style={{ display: "none" }} onChange={handleCameraCapture} />
                        <input type="file" accept="image/*" ref={avatarInputRef} style={{ display: "none" }} onChange={handleAvatarChange} />
                        <div>
                            <span className="sidebar-username" style={{ cursor: "pointer" }} onClick={openProfileModal}>{userProfile.username}</span>
                            {userProfile.title && <div style={{ fontSize: 11, color: "#6c63ff", marginTop: 1 }}>{userProfile.title}</div>}
                        </div>
                    </div>
                    <div className="sidebar-menu-wrap">
                        <button className="icon-btn-flat" onClick={(e) => { e.stopPropagation(); setShowMenu(p => !p); }} title="Menu">
                            <FaEllipsisV />
                        </button>
                        {showMenu && (
                            <div className="sidebar-menu">
                                <button className="sidebar-menu-item" onClick={() => { openProfileModal(); setShowMenu(false); }}>
                                    <FaCamera /> Profile Details
                                </button>
                                <div className="sidebar-menu-divider" />
                                <button className="sidebar-menu-item sidebar-menu-logout" onClick={handleLogout}>
                                    <FaSignOutAlt /> Logout
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {activeTab === "chats" && (
                    <div className="contact-list">
                        <div className="friends-search-wrap">
                            <input
                                className="friends-search-input"
                                placeholder="Search friends..."
                                value={friendSearch}
                                onChange={e => setFriendSearch(e.target.value)}
                            />
                        </div>
                        {usersLoading ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="contact-item" style={{ gap: 10, pointerEvents: "none" }}>
                                    <ShimmerCircularImage size={42} />
                                    <div style={{ flex: 1 }}><ShimmerText line={2} gap={8} /></div>
                                </div>
                            ))
                        ) : allUsers.filter(u => isFriend(u._id) && u.username.toLowerCase().includes(friendSearch.toLowerCase())).map(u => {
                            const unread = messages.filter(m => m.sender === u._id && !m.read).length;
                            const lastMsg = messages.filter(m => m.sender === u._id || m.receiver === u._id).slice(-1)[0];
                            return (
                                <div key={u._id} className={`contact-item ${receiverId === u._id ? "active" : ""}`} onClick={() => handleSelectChat(u)}>
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
                                                {lastMsg ? (lastMsg.type === "image" ? "📷 Photo" : lastMsg.type === "video" ? "🎥 Video" : lastMsg.type === "voice" ? "🎤 Voice" : lastMsg.type === "call" ? (lastMsg.content.includes("audio") || lastMsg.content.includes("📞") ? "📞 Audio call" : "📹 Video call") : lastMsg.content) : "No messages yet"}
                                            </span>
                                            {unread > 0 && <span className="unread-badge">{unread}</span>}
                                        </div>
                                    </div>

                                </div>
                            );
                        })}
                        {!usersLoading && allUsers.filter(u => isFriend(u._id) && u.username.toLowerCase().includes(friendSearch.toLowerCase())).length === 0 && (
                            <div className="no-friends-hint">
                                <p>No friends yet.</p>
                                <button className="req-btn req-add" onClick={() => setActiveTab("people")}><FaUserPlus /> Add People</button>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "calls" && (
                    <div className="calls-panel">
                        <div className="calls-panel-title"><FaPhone /> Recent Calls</div>
                        {allCallLogs.length === 0 ? (
                            <p className="calls-empty">No call history yet.</p>
                        ) : allCallLogs.map((log, i) => {
                            const isMe = log.sender === userProfile._id;
                            const friendId = isMe ? log.receiver : log.sender;
                            const friend = allUsers.find(u => u._id === friendId);
                            const isMissed = log.content.includes("Missed") || log.content.includes("📵");
                            const isVideo = log.content.includes("video") || log.content.includes("📹");
                            return (
                                <div key={log._id || i} className="call-log-item" onClick={() => { if (friend) handleSelectChat(friend); }}>
                                    <div className="contact-avatar-wrap">
                                        <Avatar user={friend || { username: "?" }} size="sm" />
                                        {friend && isOnline(friend._id) && <span className="online-badge" />}
                                    </div>
                                    <div className="call-log-info">
                                        <span className="call-log-name">{friend?.username || "Unknown"}</span>
                                        <span className={`call-log-type${isMissed ? " missed" : ""}`}>
                                            {isMissed ? "📵" : isVideo ? "📹" : "📞"} {isMissed ? (isMe ? "No answer" : "Missed call") : (isVideo ? "Video call" : "Audio call")}
                                        </span>
                                    </div>
                                    <span className="call-log-time">{formatTime(log.createdAt)}</span>
                                </div>
                            );
                        })}
                    </div>
                )}

                {activeTab === "status" && (
                    <StatusPanel userProfile={userProfile} onClose={() => setActiveTab("chats")} />
                )}

                {activeTab === "people" && (
                    <div className="people-panel">
                        <div className="people-panel-title"><FaUsers /> People</div>
                        <input
                            className="people-search-input"
                            placeholder="Search people..."
                            value={peopleSearch}
                            onChange={e => setPeopleSearch(e.target.value)}
                        />
                        {allUsers.filter(u => !isFriend(u._id) && u.username.toLowerCase().includes(peopleSearch.toLowerCase())).map(u => (
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
                        {allUsers.filter(u => !isFriend(u._id) && u.username.toLowerCase().includes(peopleSearch.toLowerCase())).length === 0 && (
                            <p className="people-empty">No results found</p>
                        )}
                    </div>
                )}


                {/* Mobile bottom bar */}
                <div className="sidebar-bottom-bar">
                    <button className={`sidebar-bottom-btn${activeTab === "chats" ? " sbb-active" : ""}`} onClick={() => setActiveTab("chats")}>
                        <FaCommentDots /><span>Chats</span>
                    </button>
                    <button className={`sidebar-bottom-btn${activeTab === "calls" ? " sbb-active" : ""}`} onClick={() => setActiveTab("calls")}>
                        <FaPhone /><span>Calls</span>
                    </button>
                    <button className={`sidebar-bottom-btn${activeTab === "status" ? " sbb-active" : ""}`} onClick={() => setActiveTab("status")}>
                        <FaRegCircle /><span>Status</span>
                    </button>
                    <button className={`sidebar-bottom-btn${activeTab === "people" ? " sbb-active" : ""}`} onClick={() => setActiveTab("people")}>
                        <span className="sbb-people-icon">
                            <FaUserPlus />
                            {allUsers.filter(u => u.sentMeRequest).length > 0 && (
                                <span className="req-notif-badge sbb-badge">{allUsers.filter(u => u.sentMeRequest).length}</span>
                            )}
                        </span>
                        <span>People</span>
                    </button>
                </div>
            </aside>
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
                                        <button className="icon-btn-flat delete-btn" onClick={handleDeleteSelected} disabled={selectedMsgs.size === 0} title="Delete">
                                            <FaTrash />
                                        </button>
                                        <button className="icon-btn-flat" onClick={cancelSelect} title="Cancel">
                                            <FaTimes />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button className="icon-btn-flat" onClick={handleAudioCall} title="Audio Call">
                                            <FaPhone />
                                        </button>
                                        <button className="icon-btn-flat video-btn" onClick={handleVideoCall} title="Video Call">
                                            <FaVideo />
                                        </button>
                                        <div className="chat-menu-wrap">
                                            <button className="icon-btn-flat" onClick={e => { e.stopPropagation(); setShowChatMenu(p => !p); }} title="More">
                                                <FaEllipsisV />
                                            </button>
                                            {showChatMenu && (
                                                <div className="chat-header-menu">
                                                    <button className="sidebar-menu-item" onClick={clearChat}>
                                                        <FaTrash /> Clear Chat
                                                    </button>
                                                    <div className="sidebar-menu-divider" />
                                                    <button className="sidebar-menu-item" onClick={() => { unfriend(receiverId); setShowChatMenu(false); }}>
                                                        <FaTimes /> Unfriend
                                                    </button>
                                                    <div className="sidebar-menu-divider" />
                                                    {isBlocked(receiverId) ? (
                                                        <button className="sidebar-menu-item chat-menu-unblock" onClick={() => { unblockUser(receiverId); setShowChatMenu(false); }}>
                                                            <FaUserPlus /> Unblock
                                                        </button>
                                                    ) : (
                                                        <button className="sidebar-menu-item chat-menu-block" onClick={() => { blockUser(receiverId); setShowChatMenu(false); }}>
                                                            <FaPhoneSlash /> Block
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="chat-body" ref={chatRef}>
                            {messagesLoading ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className={`msg-row ${i % 2 === 0 ? "msg-mine" : "msg-theirs"}`} style={{ pointerEvents: "none" }}>
                                        <div style={{ width: i % 2 === 0 ? "55%" : "45%" }}>
                                            <ShimmerText line={i % 3 === 0 ? 2 : 1} gap={6} />
                                        </div>
                                    </div>
                                ))
                            ) : messages.length === 0 ? (
                                <div className="no-messages"><p>No messages yet. Say hello! 👋</p></div>
                            ) : null}
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
                                            className={`msg-row ${isMine ? "msg-mine" : "msg-theirs"} ${isSelected ? "msg-selected" : ""} ${selectMode ? "select-mode-row" : ""}`}
                                            onClick={() => { if (longPressFired.current) { longPressFired.current = false; return; } if (selectMode) toggleSelectMsg(msg._id); }}
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
                                                ) : msg.type === "video" ? (
                                                    <div className="msg-image-wrap">
                                                        <video src={msg.content} className="msg-image" controls controlsList="nodownload" style={{ maxHeight: 220 }} />
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

                        {/* Image/Video Preview Bar */}
                        {mediaFiles.length > 0 && (
                            <div className="image-preview-bar">
                                {mediaFiles.map((m, i) => (
                                    <div key={i} style={{ position: "relative", display: "inline-block" }}>
                                        {m.type === "video"
                                            ? <video src={m.preview} className="preview-thumb" style={{ objectFit: "cover" }} />
                                            : <img src={m.preview} alt="preview" className="preview-thumb" />}
                                        <button className="preview-cancel" style={{ position: "absolute", top: 0, right: 0, padding: "2px 5px" }}
                                            onClick={() => setMediaFiles(prev => { const n = [...prev]; n.splice(i, 1); if (!n.length) { setImageFile(null); setImagePreview(null); } return n; })}>✕</button>
                                    </div>
                                ))}
                                <button className="preview-cancel" onClick={() => { setMediaFiles([]); setImageFile(null); setImagePreview(null); }}>Clear all</button>
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
                                        <div className="attach-wrap">
                                            <button className="icon-btn-flat" onClick={() => setShowAttachMenu(p => !p)} title="Attach"><FaEllipsisV /></button>
                                            {showAttachMenu && (
                                                <div className="attach-menu">
                                                    {/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? (
                                                        <label className="attach-item" style={{ cursor: "pointer" }} onClick={() => setShowAttachMenu(false)}>
                                                            <FaCamera /> Camera
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                capture="environment"
                                                                style={{ display: "none" }}
                                                                onChange={handleCameraCapture}
                                                            />
                                                        </label>
                                                    ) : (
                                                        <button className="attach-item" onClick={() => { setShowAttachMenu(false); openCamera(); }}>
                                                            <FaCamera /> Camera
                                                        </button>
                                                    )}
                                                    <button className="attach-item" onClick={() => { imageInputRef.current.setAttribute("accept", "image/*"); imageInputRef.current.click(); setShowAttachMenu(false); }}>
                                                        <FaImage /> Image
                                                    </button>
                                                    <button className="attach-item" onClick={() => { imageInputRef.current.setAttribute("accept", "video/*"); imageInputRef.current.click(); setShowAttachMenu(false); }}>
                                                        <FaFilm /> Video
                                                    </button>
                                                    <button className="attach-item" onClick={() => { imageInputRef.current.setAttribute("accept", "*/*"); imageInputRef.current.click(); setShowAttachMenu(false); }}>
                                                        <FaPaperPlane /> Send File
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <input type="file" accept="image/*,video/*" multiple ref={imageInputRef} style={{ display: "none" }} onChange={handleImageSelect} />
                                        <input
                                            className="msg-input"
                                            value={message}
                                            onChange={e => setMessage(e.target.value)}
                                            onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                                            placeholder="Type a message..."
                                            disabled={mediaFiles.length > 0}
                                        />
                                        {(message.trim() || mediaFiles.length) ? (
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

