/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-unused-vars */
import { useState, useEffect, useContext, useRef } from "react";
import AuthContext from "./authContext";
import { socket } from "./socket";
import axios from "axios";
import EmojiPicker from "emoji-picker-react";
import { FaSignOutAlt, FaVideo, FaSmile, FaArrowLeft } from "react-icons/fa";
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useNavigate, Link } from "react-router-dom";
import profileImage from "../assets/Amit_Photo.jpg";
import "./css/chat.css";
import { BiCheckDouble } from 'react-icons/bi'; // Import the check double icon

// Import audio files
import ringingSound from "../assets/audio/ring.mp3";
import callingSound from "../assets/audio/calling.mp3";

// const APIURL = "http://localhost:4000/api";
const APIURL = "https://yashapp-chat-application.onrender.com/api";

const generateTempId = () => Date.now().toString() + Math.random().toString(36).substr(2, 9);

const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

    if (date >= today) {
        return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (date >= yesterday) {
        return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else {
        return date.toLocaleDateString();
    }
};

const getUserAvatar = (user) => {
    const firstLetter = user.username?.charAt(0)?.toUpperCase();
    return (
        <div className="avatar-placeholder rounded-circle chat-img">
            {firstLetter}
        </div>
    );
};

const Chat = () => {
    const { user, setUser } = useContext(AuthContext);
    const [message, setMessage] = useState("");
    const [messages, setMessages] = useState([]);
    const [receiver, setReceiver] = useState("");
    const [receiverId, setReceiverId] = useState("");
    const [receiverName, setReceiverName] = useState("");
    const [onlineUsers, setOnlineUsers] = useState({});
    const [userProfile, setUserProfile] = useState({});
    const [allUsers, setAllUsers] = useState([]);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const chatRef = useRef(null);
    const navigate = useNavigate();
    const callingAudio = useRef(new Audio(callingSound));
    const ringingAudio = useRef(new Audio(ringingSound));

    const [showSidebar, setShowSidebar] = useState(true);
    const [videoCallData, setVideoCallData] = useState(null);
    const [isCalling, setIsCalling] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem("token");
        if (!token) {
            navigate("/");
            return;
        }
        axios.get(`${APIURL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
            .then(res => {
                setUserProfile(res.data);
                const lastReceiverId = localStorage.getItem("lastReceiverId");
                const lastReceiverName = localStorage.getItem("lastReceiverName");
                if (lastReceiverId && lastReceiverName) {
                    setReceiverId(lastReceiverId);
                    setReceiverName(lastReceiverName);
                }
            })
            .catch(() => navigate("/"));
    }, []);

    useEffect(() => {
        if (userProfile._id) {
            socket.emit("user-online", userProfile._id);
            socket.on("update-user-status", setOnlineUsers);
            
            socket.on("call-invitation", ({ from, name }) => {
                setVideoCallData({ callerId: from, callerName: name });
                ringingAudio.current.play().catch(e => console.error("Ringing sound error:", e));
                toast.info(`${name} is calling...`, { autoClose: false, closeButton: false });
            });

            socket.on("call-accepted", () => {
                setIsCalling(true);
                callingAudio.current.pause();
                callingAudio.current.currentTime = 0;
                navigate(`/video/${receiverId}`);
            });
            
            socket.on("call-rejected", () => {
                setIsCalling(false);
                callingAudio.current.pause();
                callingAudio.current.currentTime = 0;
                setVideoCallData(null);
                toast.dismiss();
                toast.info(`${videoCallData?.callerName || "User"} rejected the call.`);
            });
            
            // New listener for when a message is marked as read
            socket.on("messageRead", (updatedMessage) => {
                setMessages(prev => 
                    prev.map(msg => 
                        msg._id === updatedMessage._id ? { ...msg, read: updatedMessage.read } : msg
                    )
                );
            });

            return () => {
                socket.off("update-user-status");
                socket.off("call-invitation");
                socket.off("call-accepted");
                socket.off("call-rejected");
                socket.off("messageRead"); // Clean up the new listener
                callingAudio.current.pause();
                callingAudio.current.currentTime = 0;
                ringingAudio.current.pause();
                ringingAudio.current.currentTime = 0;
            };
        }
    }, [userProfile]);

    useEffect(() => {
        if (!userProfile._id || !receiverId) return;

        const fetchMessages = async () => {
            try {
                const res = await axios.get(`${APIURL}/chat/messages/${receiverId}?userId=${userProfile._id}`, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`
                    }
                });
                setMessages(res.data);
            } catch (error) {
                console.error("Failed to fetch messages:", error);
                setMessages([]);
            }
        };

        const handleReceiveMessage = (data) => {
            if (data.sender === receiverId && data.receiver === userProfile._id) {
                // Mark the received message as read on the backend
                axios.put(`${APIURL}/chat/read/${data._id}`, {}, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`
                    }
                }).catch(err => console.error("Failed to mark message as read:", err));
            }

            setMessages(prev => {
                if (data.sender === receiverId || data.receiver === receiverId) {
                    return [...prev, data];
                }
                return prev;
            });
        };

        socket.on("receiveMessage", handleReceiveMessage);
        fetchMessages();

        return () => {
            socket.off("receiveMessage", handleReceiveMessage);
        };
    }, [userProfile, receiverId]);

    useEffect(() => {
        const fetchAllUsers = async () => {
            try {
                const res = await axios.get(`${APIURL}/auth/users`, {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem("token")}`
                    }
                });
                setAllUsers(res.data.filter(u => u._id !== userProfile._id));
            } catch (error) {
                console.error("Failed to fetch users:", error);
            }
        };
        if (userProfile._id) {
            fetchAllUsers();
        }
    }, [userProfile]);

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth > 768) {
                setShowSidebar(true);
            } else {
                if (receiverId) {
                    setShowSidebar(false);
                } else {
                    setShowSidebar(true);
                }
            }
        };
        window.addEventListener('resize', handleResize);
        handleResize();
        return () => window.removeEventListener('resize', handleResize);
    }, [receiverId]);

    const handleSelectChat = (selectedUser) => {
        localStorage.setItem("lastReceiverId", selectedUser._id);
        localStorage.setItem("lastReceiverName", selectedUser.username);
        setReceiver(selectedUser.username);
        setReceiverId(selectedUser._id);
        setReceiverName(selectedUser.username);
        setShowSidebar(false);
    };

    const handleBackClick = () => {
        setShowSidebar(true);
        setReceiverId("");
        setReceiverName("");
        setMessages([]);
    };
    
    const sendMessage = async () => {
        if (!message || !receiverId) {
            toast.error("Please select a user and type a message.");
            return;
        }
        
        const tempId = generateTempId();
        const data = {
            sender: userProfile._id,
            receiver: receiverId,
            content: message,
            type: "text",
            createdAt: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, { ...data, _id: tempId }]);
        setMessage("");

        try {
            const res = await axios.post(`${APIURL}/chat/send`, data, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                },
            });
            const savedMessage = res.data;

            setMessages((prev) => 
                prev.map((msg) => (msg._id === tempId ? savedMessage : msg))
            );

            socket.emit("sendMessage", savedMessage);
            
        } catch (error) {
            console.error("Message send failed:", error);
            toast.error("Message send failed");
            setMessages((prev) => prev.filter((msg) => msg._id !== tempId));
        }
    };

    const handleVideoCall = () => {
        if (!receiverId) {
            toast.error("Please select a user to call.");
            return;
        }
        setIsCalling(true);
        callingAudio.current.loop = true;
        callingAudio.current.play().catch(e => console.error("Calling sound error:", e));
        socket.emit("call-invitation", {
            to: receiverId,
            from: userProfile._id,
            name: userProfile.username
        });
        toast.info(`Calling ${receiverName}...`, { autoClose: false, closeButton: false });
    };

    const acceptCall = () => {
        setIsCalling(true);
        ringingAudio.current.pause();
        ringingAudio.current.currentTime = 0;
        socket.emit("call-accepted", { to: videoCallData.callerId });
        navigate(`/video/${videoCallData.callerId}`);
        toast.dismiss();
    };

    const rejectCall = () => {
        ringingAudio.current.pause();
        ringingAudio.current.currentTime = 0;
        socket.emit("call-rejected", { to: videoCallData.callerId });
        setVideoCallData(null);
        setIsCalling(false);
        toast.dismiss();
    };

    const handleLogout = () => {
        localStorage.clear();
        setUser(null);
        navigate("/");
        toast.info("Logged out");
    };

    useEffect(() => {
        if (chatRef.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
    }, [messages]);

    return (
        <div className="whatsapp-container">
            <ToastContainer />
            {videoCallData && (
                <div className="call-notification">
                    <p>{videoCallData.callerName} is calling you...</p>
                    <div className="d-flex gap-2">
                        <button className="call-button accept" onClick={acceptCall}>Accept</button>
                        <button className="call-button reject" onClick={rejectCall}>Reject</button>
                    </div>
                </div>
            )}
            <div className={`sidebar ${!showSidebar ? 'hide-on-mobile' : ''}`}>
                <div className="profile-header">
                    <div>
                        <img src={profileImage} alt="Profile" className="rounded-circle profile-img" />
                        <span>{userProfile.username}</span>
                    </div>
                    <button className="btn btn-logout" onClick={handleLogout}>
                        <FaSignOutAlt />
                    </button>
                </div>
                <div className="chat-list">
                    {allUsers.map((u) => (
                        <div key={u._id} className={`chat-item ${receiverId === u._id ? 'active' : ''}`} onClick={() => handleSelectChat(u)}>
                            {getUserAvatar(u)}
                            <div className="chat-info">
                                <span className="chat-name">{u.username}</span>
                                <small className={`status-dot ${onlineUsers[u._id] ? 'online' : 'offline'}`}></small>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className={`chat-main ${showSidebar ? 'hide-on-mobile' : ''}`}>
                <div className="chat-header">
                    <div className="d-flex align-items-center">
                        {window.innerWidth <= 768 && !showSidebar && (
                            <button className="btn btn-back me-2" onClick={handleBackClick}>
                                <FaArrowLeft />
                            </button>
                        )}
                        {receiverId ? getUserAvatar({ username: receiverName }) : <img src={profileImage} alt="Receiver" className="rounded-circle me-2 chat-img" />}
                        <div className="chat-header-info">
                            <div className="fw-bold">{receiverName || "Select a chat"}</div>
                            <small className="text-muted">{receiverId && (onlineUsers[receiverId] ? "Online" : "Offline")}</small>
                        </div>
                    </div>
                    {receiverId && (
                        <button className="btn btn-video-call" onClick={handleVideoCall}>
                            <FaVideo />
                        </button>
                    )}
                </div>

                <div className="chat-box" ref={chatRef}>
                    {messages.length === 0 && (
                        <div className="empty-chat-message">
                            <p>No messages yet. Start a conversation!</p>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <div key={i} className={`message-bubble ${msg.sender === userProfile._id ? "sent" : "received"}`}>
                            <div className="message-content">
                                {msg.type === "image" ? (
                                    <img src={msg.content} alt="sent" className="message-image" />
                                ) : (
                                    <p>{msg.content}</p>
                                )}
                                <div className="message-status-container">
                                    <span className="message-time">{formatDate(msg.createdAt)}</span>
                                    {/* Display read ticks only for sent messages */}
                                    {msg.sender === userProfile._id && (
                                        <BiCheckDouble 
                                            className={`read-receipt-tick ${msg.read ? 'read-blue' : 'unread-gray'}`} 
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="chat-input-area">
                    {showEmojiPicker && (
                        <EmojiPicker onEmojiClick={(emojiData) => setMessage(prev => prev + emojiData.emoji)} />
                    )}
                    <button className="btn btn-icon" onClick={() => setShowEmojiPicker(!showEmojiPicker)}>
                        <FaSmile />
                    </button>
                    <input
                        className="form-control message-input"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                        placeholder="Type a message"
                        disabled={!receiverId}
                    />
                    <button className="btn btn-primary send-btn" onClick={sendMessage} disabled={!receiverId || !message}>
                       <span className="send-icons">▷</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Chat;