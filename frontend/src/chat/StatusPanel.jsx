/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { FaTimes, FaPlus, FaEye, FaTrash, FaImage, FaFont, FaVideo } from "react-icons/fa";
import { socket } from "./socket";
import "./css/status.css";

const APIURL = `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api`;

const BG_COLORS = ["#1e1e2e", "#6c63ff", "#7c3aed", "#0f766e", "#b45309", "#be123c", "#1d4ed8", "#166534"];

const timeAgo = (d) => {
    const diff = Date.now() - new Date(d).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `${h}h ago`;
    if (m > 0) return `${m}m ago`;
    return "Just now";
};

const expiryPercent = (createdAt) => {
    const elapsed = Date.now() - new Date(createdAt).getTime();
    return Math.min(100, (elapsed / 86400000) * 100);
};

const Avatar = ({ user, size = 44 }) => {
    if (user?.avatar) {
        return <img src={user.avatar} alt={user.username} className="st-avatar" style={{ width: size, height: size }} />;
    }
    return (
        <div className="st-avatar st-avatar-init" style={{ width: size, height: size, fontSize: size * 0.4 }}>
            {user?.username?.charAt(0)?.toUpperCase() || "?"}
        </div>
    );
};

const StatusPanel = ({ userProfile, onClose }) => {
    const [statuses, setStatuses] = useState([]);
    const [viewing, setViewing] = useState(null);   // { userId, statuses[], index }
    const [viewingIdx, setViewingIdx] = useState(0);
    const [showSeenBy, setShowSeenBy] = useState(false);
    const [showCompose, setShowCompose] = useState(false);
    const [composeType, setComposeType] = useState("text");
    const [textContent, setTextContent] = useState("");
    const [bgColor, setBgColor] = useState(BG_COLORS[0]);
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [videoFile, setVideoFile] = useState(null);
    const [videoPreview, setVideoPreview] = useState(null);
    const [caption, setCaption] = useState("");
    const [posting, setPosting] = useState(false);
    const imageInputRef = useRef(null);
    const videoInputRef = useRef(null);
    const progressRef = useRef(null);
    const autoAdvanceRef = useRef(null);
    const progressIntervalRef = useRef(null);
    const [progressWidth, setProgressWidth] = useState(0);

    const token = localStorage.getItem("token");
    const headers = { Authorization: `Bearer ${token}` };

    const fetchStatuses = async () => {
        try {
            const res = await axios.get(`${APIURL}/status`, { headers });
            setStatuses(res.data);
        } catch {}
    };

    useEffect(() => {
        fetchStatuses();
        const handleNew = (s) => setStatuses(prev => [s, ...prev.filter(x => x._id !== s._id)]);
        socket.on("new-status", handleNew);
        return () => socket.off("new-status", handleNew);
    }, []);

    // Group statuses by user
    const grouped = statuses.reduce((acc, s) => {
        const uid = s.user._id;
        if (!acc[uid]) acc[uid] = { user: s.user, items: [] };
        acc[uid].items.push(s);
        return acc;
    }, {});

    const myGroup = grouped[userProfile._id];
    const friendGroups = Object.values(grouped).filter(g => g.user._id !== userProfile._id);

    const openViewer = async (group, idx = 0) => {
        setViewing(group);
        setViewingIdx(idx);
        setShowSeenBy(false);
        // mark as viewed
        const s = group.items[idx];
        if (s.user._id !== userProfile._id && !s.viewers?.find(v => v._id === userProfile._id)) {
            await axios.post(`${APIURL}/status/${s._id}/view`, {}, { headers });
            setStatuses(prev => prev.map(x => x._id === s._id
                ? { ...x, viewers: [...(x.viewers || []), { _id: userProfile._id, username: userProfile.username, avatar: userProfile.avatar }] }
                : x
            ));
        }
    };

    const closeViewer = () => { setViewing(null); clearTimeout(autoAdvanceRef.current); clearInterval(progressIntervalRef.current); };

    const goNext = () => {
        clearTimeout(autoAdvanceRef.current);
        clearInterval(progressIntervalRef.current);
        if (viewingIdx < viewing.items.length - 1) {
            const nextIdx = viewingIdx + 1;
            setViewingIdx(nextIdx);
            setShowSeenBy(false);
            markViewed(viewing.items[nextIdx]);
        } else closeViewer();
    };

    const goPrev = () => {
        clearTimeout(autoAdvanceRef.current);
        clearInterval(progressIntervalRef.current);
        if (viewingIdx > 0) { setViewingIdx(i => i - 1); setShowSeenBy(false); }
    };

    const markViewed = async (s) => {
        if (s.user._id !== userProfile._id && !s.viewers?.find(v => v._id === userProfile._id)) {
            await axios.post(`${APIURL}/status/${s._id}/view`, {}, { headers });
            setStatuses(prev => prev.map(x => x._id === s._id
                ? { ...x, viewers: [...(x.viewers || []), { _id: userProfile._id, username: userProfile.username, avatar: userProfile.avatar }] }
                : x
            ));
        }
    };

    // Auto-advance after 30s with real progress
    useEffect(() => {
        if (!viewing) return;
        clearTimeout(autoAdvanceRef.current);
        clearInterval(progressIntervalRef.current);
        setProgressWidth(0);
        const DURATION = 30000;
        const TICK = 100;
        let elapsed = 0;
        progressIntervalRef.current = setInterval(() => {
            elapsed += TICK;
            setProgressWidth(Math.min(100, (elapsed / DURATION) * 100));
            if (elapsed >= DURATION) {
                clearInterval(progressIntervalRef.current);
                goNext();
            }
        }, TICK);
        return () => {
            clearTimeout(autoAdvanceRef.current);
            clearInterval(progressIntervalRef.current);
        };
    }, [viewing, viewingIdx]);

    const deleteStatus = async (id) => {
        try {
            await axios.delete(`${APIURL}/status/${id}`, { headers });
            setStatuses(prev => prev.filter(s => s._id !== id));
            if (viewing) {
                const remaining = viewing.items.filter(s => s._id !== id);
                if (remaining.length === 0) closeViewer();
                else { setViewing({ ...viewing, items: remaining }); setViewingIdx(i => Math.min(i, remaining.length - 1)); }
            }
        } catch {}
    };

    const postStatus = async () => {
        if (posting) return;
        setPosting(true);
        try {
            if (composeType === "text") {
                if (!textContent.trim()) return;
                await axios.post(`${APIURL}/status/text`, { content: textContent, bgColor }, { headers });
            } else if (composeType === "video") {
                if (!videoFile) return;
                const fd = new FormData();
                fd.append("video", videoFile);
                fd.append("caption", caption);
                await axios.post(`${APIURL}/status/video`, fd, { headers });
            } else {
                if (!imageFile) return;
                const fd = new FormData();
                fd.append("image", imageFile);
                fd.append("caption", caption);
                await axios.post(`${APIURL}/status/image`, fd, { headers });
            }
            await fetchStatuses();
            setShowCompose(false);
            setTextContent(""); setImageFile(null); setImagePreview(null);
            setVideoFile(null); setVideoPreview(null); setCaption("");
        } catch {}
        setPosting(false);
    };

    const handleImagePick = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
        e.target.value = "";
    };

    const handleVideoPick = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setVideoFile(file);
        setVideoPreview(URL.createObjectURL(file));
        e.target.value = "";
    };

    const currentStatus = viewing?.items[viewingIdx];
    const isMyStatus = currentStatus?.user._id === userProfile._id;
    const currentViewers = statuses.find(s => s._id === currentStatus?._id)?.viewers || [];

    return (
        <div className="st-panel">
            {/* Header */}
            <div className="st-header">
                <span className="st-title">Status</span>
                <button className="st-close-btn" onClick={onClose}><FaTimes /></button>
            </div>

            {/* My Status */}
            <div className="st-section-label">My Status</div>
            <div className="st-my-row" onClick={() => myGroup ? openViewer(myGroup) : setShowCompose(true)}>
                <div className="st-avatar-ring-wrap">
                    <Avatar user={userProfile} size={46} />
                    {myGroup ? <div className="st-ring st-ring-mine" /> : <div className="st-add-badge"><FaPlus /></div>}
                </div>
                <div className="st-info">
                    <span className="st-name">My Status</span>
                    <span className="st-sub">{myGroup ? `${myGroup.items.length} update${myGroup.items.length > 1 ? "s" : ""} • ${timeAgo(myGroup.items[0].createdAt)}` : "Tap to add status"}</span>
                </div>
                <button className="st-add-btn" onClick={e => { e.stopPropagation(); setShowCompose(true); }} title="Add status"><FaPlus /></button>
            </div>

            {/* Friends Statuses */}
            {friendGroups.length > 0 && <div className="st-section-label">Recent updates</div>}
            <div className="st-list">
                {friendGroups.map(g => {
                    const unseen = g.items.some(s => !s.viewers?.find(v => v._id === userProfile._id));
                    return (
                        <div key={g.user._id} className="st-friend-row" onClick={() => openViewer(g)}>
                            <div className="st-avatar-ring-wrap">
                                <Avatar user={g.user} size={46} />
                                <div className={`st-ring ${unseen ? "st-ring-unseen" : "st-ring-seen"}`} />
                            </div>
                            <div className="st-info">
                                <span className="st-name">{g.user.username}</span>
                                <span className="st-sub">{timeAgo(g.items[0].createdAt)}</span>
                            </div>
                        </div>
                    );
                })}
                {friendGroups.length === 0 && <p className="st-empty">No friend updates yet</p>}
            </div>

            {/* Compose */}
            {showCompose && (
                <div className="st-compose-overlay">
                    <div className="st-compose">
                        <div className="st-compose-header">
                            <span>Add Status</span>
                            <button onClick={() => setShowCompose(false)}><FaTimes /></button>
                        </div>
                        <div className="st-compose-tabs">
                            <button className={composeType === "text" ? "active" : ""} onClick={() => setComposeType("text")}><FaFont /> Text</button>
                            <button className={composeType === "image" ? "active" : ""} onClick={() => setComposeType("image")}><FaImage /> Image</button>
                            <button className={composeType === "video" ? "active" : ""} onClick={() => setComposeType("video")}><FaVideo /> Video</button>
                        </div>
                        {composeType === "text" ? (
                            <div className="st-text-compose" style={{ background: bgColor }}>
                                <textarea
                                    className="st-text-input"
                                    placeholder="Type your status..."
                                    value={textContent}
                                    onChange={e => setTextContent(e.target.value)}
                                    maxLength={200}
                                />
                                <div className="st-bg-picker">
                                    {BG_COLORS.map(c => (
                                        <button key={c} className={`st-bg-swatch ${bgColor === c ? "selected" : ""}`} style={{ background: c }} onClick={() => setBgColor(c)} />
                                    ))}
                                </div>
                            </div>
                        ) : composeType === "video" ? (
                            <div className="st-image-compose">
                                {videoPreview
                                    ? <video src={videoPreview} className="st-img-preview" controls style={{ maxHeight: 200, width: "100%", borderRadius: 12 }} />
                                    : <button className="st-img-pick-btn" onClick={() => videoInputRef.current.click()}><FaVideo /> Pick Video</button>
                                }
                                <input type="file" accept="video/*" ref={videoInputRef} style={{ display: "none" }} onChange={handleVideoPick} />
                                {videoPreview && (
                                    <input className="st-caption-input" placeholder="Add a caption..." value={caption} onChange={e => setCaption(e.target.value)} />
                                )}
                            </div>
                        ) : (
                            <div className="st-image-compose">
                                {imagePreview
                                    ? <img src={imagePreview} className="st-img-preview" alt="preview" />
                                    : <button className="st-img-pick-btn" onClick={() => imageInputRef.current.click()}><FaImage /> Pick Image</button>
                                }
                                <input type="file" accept="image/*" ref={imageInputRef} style={{ display: "none" }} onChange={handleImagePick} />
                                {imagePreview && (
                                    <input className="st-caption-input" placeholder="Add a caption..." value={caption} onChange={e => setCaption(e.target.value)} />
                                )}
                            </div>
                        )}
                        <button className="st-post-btn" onClick={postStatus} disabled={posting}>
                            {posting ? "Posting..." : "Post Status"}
                        </button>
                    </div>
                </div>
            )}

            {/* Viewer */}
            {viewing && currentStatus && (
                <div className="st-viewer-overlay">
                    {/* Progress bars */}
                    <div className="st-progress-bars">
                        {viewing.items.map((s, i) => (
                            <div key={s._id} className="st-progress-track">
                                <div className="st-progress-fill" style={{
                                    width: i < viewingIdx ? "100%" : i === viewingIdx ? `${progressWidth}%` : "0%",
                                    transition: i === viewingIdx ? "none" : "none"
                                }} />
                            </div>
                        ))}
                    </div>

                    {/* Top bar */}
                    <div className="st-viewer-top">
                        <Avatar user={currentStatus.user} size={36} />
                        <div className="st-viewer-info">
                            <span className="st-viewer-name">{currentStatus.user.username}</span>
                            <span className="st-viewer-time">{timeAgo(currentStatus.createdAt)}</span>
                        </div>
                        <div className="st-viewer-actions">
                            {isMyStatus && (
                                <>
                                    <button className="st-viewer-btn" onClick={() => setShowSeenBy(p => !p)} title="Seen by"><FaEye /></button>
                                    <button className="st-viewer-btn st-del-btn" onClick={() => deleteStatus(currentStatus._id)} title="Delete"><FaTrash /></button>
                                </>
                            )}
                            <button className="st-viewer-btn" onClick={closeViewer}><FaTimes /></button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="st-viewer-content" onClick={goNext}>
                        {currentStatus.type === "text" ? (
                            <div className="st-viewer-text" style={{ background: currentStatus.bgColor }}>
                                <p>{currentStatus.content}</p>
                            </div>
                        ) : currentStatus.type === "video" ? (
                            <div className="st-viewer-image" onClick={e => e.stopPropagation()}>
                                <video src={currentStatus.content} controls autoPlay style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: 8 }} />
                                {currentStatus.caption && <p className="st-viewer-caption">{currentStatus.caption}</p>}
                            </div>
                        ) : (
                            <div className="st-viewer-image">
                                <img src={currentStatus.content} alt="status" />
                                {currentStatus.caption && <p className="st-viewer-caption">{currentStatus.caption}</p>}
                            </div>
                        )}
                    </div>

                    {/* Prev / Next tap zones */}
                    <div className="st-tap-prev" onClick={e => { e.stopPropagation(); goPrev(); }} />
                    <div className="st-tap-next" onClick={e => { e.stopPropagation(); goNext(); }} />

                    {/* Seen by panel */}
                    {showSeenBy && isMyStatus && (
                        <div className="st-seenby-panel" onClick={e => e.stopPropagation()}>
                            <div className="st-seenby-title"><FaEye /> Seen by {currentViewers.length}</div>
                            {currentViewers.length === 0
                                ? <p className="st-seenby-empty">No views yet</p>
                                : currentViewers.map(v => (
                                    <div key={v._id} className="st-seenby-row">
                                        <Avatar user={v} size={32} />
                                        <span>{v.username}</span>
                                    </div>
                                ))
                            }
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StatusPanel;
