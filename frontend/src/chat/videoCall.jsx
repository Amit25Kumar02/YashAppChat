/* eslint-disable react-hooks/exhaustive-deps */
import { useRef, useEffect, useState, useCallback } from "react";
import { socket } from "./socket";
import "./videocall.css";
import { FaMicrophoneSlash, FaMicrophone, FaVideoSlash, FaVideo, FaCameraRotate } from "react-icons/fa6";
import { MdCallEnd } from "react-icons/md";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.relay.metered.ca:80" },
        {
            urls: "turn:global.relay.metered.ca:80",
            username: "0d27b14bcb30e112b265895c",
            credential: "BAd45EyxxheMwrL2",
        },
        {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username: "0d27b14bcb30e112b265895c",
            credential: "BAd45EyxxheMwrL2",
        },
        {
            urls: "turn:global.relay.metered.ca:443",
            username: "0d27b14bcb30e112b265895c",
            credential: "BAd45EyxxheMwrL2",
        },
        {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username: "0d27b14bcb30e112b265895c",
            credential: "BAd45EyxxheMwrL2",
        },
    ],
};

const APIURL = `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api`;

const VideoCall = () => {
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const pendingCandidates = useRef([]);
    const remoteStreamRef = useRef(null);

    const [callEstablished, setCallEstablished] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [callDuration, setCallDuration] = useState(0);
    const [hasRemoteStream, setHasRemoteStream] = useState(false);
    const [swapped, setSwapped] = useState(false);
    const [facingMode, setFacingMode] = useState("user");
    const [pipPos, setPipPos] = useState({ right: 20, bottom: 100 });
    const [showControls, setShowControls] = useState(true);
    const durationRef = useRef(null);
    const dragRef = useRef(null);
    const lastTapRef = useRef(0);
    const tapTimeoutRef = useRef(null);

    const { receiverId } = useParams();
    const [searchParams] = useSearchParams();
    const role = searchParams.get("role") || "caller";
    const navigate = useNavigate();

    const getPC = () => pcRef.current;

    const attachRemoteStream = useCallback((stream) => {
        remoteStreamRef.current = stream;
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            remoteVideoRef.current.play().catch(() => { });
        }
        setHasRemoteStream(true);
        setCallEstablished(true);
    }, []);

    const remoteVideoCallbackRef = useCallback((node) => {
        remoteVideoRef.current = node;
        if (node && remoteStreamRef.current) {
            node.srcObject = remoteStreamRef.current;
            node.play().catch(() => { });
        }
    }, []);

    const setupPC = () => {
        if (pcRef.current) pcRef.current.close();
        const pc = new RTCPeerConnection(ICE_SERVERS);

        pc.ontrack = (e) => {
            console.log("🎥 Remote track received", e.streams);
            if (e.streams && e.streams[0]) attachRemoteStream(e.streams[0]);
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) socket.emit("ice-candidate", { to: receiverId, candidate: e.candidate });
        };

        pc.oniceconnectionstatechange = () => {
            console.log("🧊 ICE state:", pc.iceConnectionState);
        };

        pc.onconnectionstatechange = () => {
            console.log("🔗 Connection state:", pc.connectionState);
            if (pc.connectionState === "failed") {
                toast.error("Connection failed. Check network.");
                cleanup(false);
                navigate("/chat");
            }
        };

        pcRef.current = pc;
        return pc;
    };

    const getLocalStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStreamRef.current = stream;
            if (localVideoRef.current) localVideoRef.current.srcObject = stream;
            stream.getTracks().forEach(t => getPC()?.addTrack(t, stream));
            return stream;
        } catch (err) {
            console.error("❌ Media error:", err);
            toast.error("Camera/microphone access denied.");
            return null;
        }
    };

    const cleanup = (notify = true) => {
        clearInterval(durationRef.current);
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(t => t.stop());
            localStreamRef.current = null;
        }
        if (pcRef.current) {
            pcRef.current.ontrack = null;
            pcRef.current.onicecandidate = null;
            pcRef.current.oniceconnectionstatechange = null;
            pcRef.current.onconnectionstatechange = null;
            pcRef.current.close();
            pcRef.current = null;
        }
        if (notify) socket.emit("call-ended", { to: receiverId });
    };

    useEffect(() => {
        // Block browser back button during call
        window.history.pushState(null, "", window.location.href);
        const handlePopState = () => {
            window.history.pushState(null, "", window.location.href);
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, []);

    useEffect(() => {
        let mounted = true;
        const myId = localStorage.getItem("myUserId");
        if (myId) socket.emit("user-online", myId);

        const init = async () => {
            setupPC();
            await getLocalStream();
            if (!mounted) return;
            if (role === "caller") {
                await new Promise(r => setTimeout(r, 1000));
                if (!mounted) return;
                try {
                    const offer = await getPC().createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
                    await getPC().setLocalDescription(offer);
                    socket.emit("offer", { to: receiverId, from: myId, sdp: offer });
                    console.log("📤 Offer sent to", receiverId);
                } catch (err) {
                    console.error("❌ Error creating offer:", err);
                }
            }
        };

        const handleOffer = async ({ sdp }) => {
            if (!mounted) return;
            console.log("📥 Offer received");
            try {
                await getPC().setRemoteDescription(new RTCSessionDescription(sdp));
                for (const c of pendingCandidates.current)
                    await getPC().addIceCandidate(new RTCIceCandidate(c));
                pendingCandidates.current = [];
                const answer = await getPC().createAnswer();
                await getPC().setLocalDescription(answer);
                socket.emit("answer", { to: receiverId, sdp: answer });
                console.log("📤 Answer sent");
            } catch (err) {
                console.error("❌ Error handling offer:", err);
            }
        };

        const handleAnswer = async ({ sdp }) => {
            if (!mounted) return;
            console.log("📥 Answer received");
            try {
                await getPC().setRemoteDescription(new RTCSessionDescription(sdp));
                for (const c of pendingCandidates.current)
                    await getPC().addIceCandidate(new RTCIceCandidate(c));
                pendingCandidates.current = [];
            } catch (err) {
                console.error("❌ Error handling answer:", err);
            }
        };

        const handleIceCandidate = async ({ candidate }) => {
            if (!mounted || !candidate) return;
            try {
                if (getPC()?.remoteDescription?.type)
                    await getPC().addIceCandidate(new RTCIceCandidate(candidate));
                else
                    pendingCandidates.current.push(candidate);
            } catch (err) {
                console.error("❌ ICE error:", err);
            }
        };

        const handleCallEnded = () => {
            if (!mounted) return;
            toast.info("Call ended.");
            cleanup(false);
            navigate("/chat");
        };

        socket.on("offer", handleOffer);
        socket.on("answer", handleAnswer);
        socket.on("ice-candidate", handleIceCandidate);
        socket.on("call-ended", handleCallEnded);

        init();

        return () => {
            mounted = false;
            socket.off("offer", handleOffer);
            socket.off("answer", handleAnswer);
            socket.off("ice-candidate", handleIceCandidate);
            socket.off("call-ended", handleCallEnded);
            cleanup(false);
            const myId = localStorage.getItem("myUserId");
            if (myId) socket.emit("user-online", myId);
        };
    }, []);

    useEffect(() => {
        if (callEstablished) {
            durationRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
        }
        return () => clearInterval(durationRef.current);
    }, [callEstablished]);

    useEffect(() => {
        if (!showControls) return;
        const timer = setTimeout(() => setShowControls(false), 3000);
        return () => clearTimeout(timer);
    }, [showControls]);

    const handleTap = () => {
        const now = Date.now();
        const DOUBLE_TAP_DELAY = 300;
        navigator.vibrate?.(10);
        if (lastTapRef.current && (now - lastTapRef.current < DOUBLE_TAP_DELAY)) {
            clearTimeout(tapTimeoutRef.current);
            lastTapRef.current = 0;
            setSwapped(prev => !prev);
        } else {
            lastTapRef.current = now;
            tapTimeoutRef.current = setTimeout(() => {
                setShowControls(prev => !prev);
                lastTapRef.current = 0;
            }, DOUBLE_TAP_DELAY);
        }
    };

    const formatDuration = (s) => {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
    };

    const endCall = () => {
        const duration = callDuration;
        cleanup(true);
        const myId = localStorage.getItem("myUserId");
        const content = duration > 0 ? `📹 Video call ended • ${formatDuration(duration)}` : `📹 Video call ended`;
        fetch(`${APIURL}/chat/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
            body: JSON.stringify({ sender: myId, receiver: receiverId, content, type: "call" }),
        }).then(r => r.json()).then(saved => socket.emit("sendMessage", saved)).catch(() => { });
        navigate("/chat");
    };

    const toggleMute = () => {
        const tracks = localStreamRef.current?.getAudioTracks();
        if (tracks?.length) { tracks[0].enabled = !tracks[0].enabled; setIsMuted(p => !p); }
    };

    const toggleCamera = () => {
        const tracks = localStreamRef.current?.getVideoTracks();
        if (tracks?.length) { tracks[0].enabled = !tracks[0].enabled; setIsCameraOff(p => !p); }
    };

    const flipCamera = async () => {
        const newFacing = facingMode === "user" ? "environment" : "user";
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newFacing }, audio: true });
            const newVideoTrack = newStream.getVideoTracks()[0];
            const sender = getPC()?.getSenders().find(s => s.track?.kind === "video");
            if (sender) await sender.replaceTrack(newVideoTrack);
            localStreamRef.current.getVideoTracks().forEach(t => t.stop());
            localStreamRef.current.removeTrack(localStreamRef.current.getVideoTracks()[0]);
            localStreamRef.current.addTrack(newVideoTrack);
            if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
            setFacingMode(newFacing);
        } catch (err) {
            toast.error("Could not flip camera.");
        }
    };

    return (
        <div className="vc-container">
            <video
                ref={swapped ? localVideoRef : remoteVideoCallbackRef}
                className="vc-remote"
                autoPlay playsInline
                muted={swapped}
                onClick={() => setShowControls(prev => !prev)}
            />

            {!hasRemoteStream && (
                <div className="vc-waiting">
                    <div className="vc-waiting-avatar">📞</div>
                    <p>{role === "caller" ? "Calling..." : "Connecting..."}</p>
                    <div className="vc-controls vc-controls-waiting">
                        <button className={`vc-btn ${isMuted ? "vc-btn-active" : ""}`} onClick={toggleMute}>
                            {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                        </button>
                        <button className="vc-btn vc-btn-end" onClick={endCall}>
                            <MdCallEnd />
                        </button>
                        <button className={`vc-btn ${isCameraOff ? "vc-btn-active" : ""}`} onClick={toggleCamera}>
                            {isCameraOff ? <FaVideoSlash /> : <FaVideo />}
                        </button>
                        <button className="vc-btn" onClick={flipCamera}>
                            <FaCameraRotate />
                        </button>
                    </div>
                </div>
            )}

            {callEstablished && (
                <div className="vc-timer">{formatDuration(callDuration)}</div>
            )}

            <video
                ref={swapped ? remoteVideoCallbackRef : localVideoRef}
                className="vc-local"
                autoPlay playsInline
                muted={!swapped}
                style={{ right: pipPos.right, bottom: pipPos.bottom, left: "unset", top: "unset" }}
                onClick={() => {
                    if (dragRef.current?.didDrag) return;
                    handleTap();
                }}
                onMouseDown={(e) => {
                    e.preventDefault();
                    const startX = e.clientX, startY = e.clientY;
                    const startRight = pipPos.right, startBottom = pipPos.bottom;
                    dragRef.current = { didDrag: false };
                    const onMove = (me) => {
                        const dx = me.clientX - startX, dy = me.clientY - startY;
                        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.didDrag = true;
                        const newRight = Math.max(0, Math.min(window.innerWidth - 100, startRight - dx));
                        const newBottom = Math.max(0, Math.min(window.innerHeight - 140, startBottom - dy));
                        setPipPos({ right: newRight, bottom: newBottom });
                    };
                    const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                    };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                }}
                onTouchStart={(e) => {
                    const t = e.touches[0];
                    const startX = t.clientX, startY = t.clientY;
                    const startRight = pipPos.right, startBottom = pipPos.bottom;
                    dragRef.current = { didDrag: false };
                    const onMove = (te) => {
                        const tc = te.touches[0];
                        const dx = tc.clientX - startX, dy = tc.clientY - startY;
                        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.didDrag = true;
                        const newRight = Math.max(0, Math.min(window.innerWidth - 100, startRight - dx));
                        const newBottom = Math.max(0, Math.min(window.innerHeight - 140, startBottom - dy));
                        setPipPos({ right: newRight, bottom: newBottom });
                    };
                    const onUp = () => {
                        window.removeEventListener("touchmove", onMove);
                        window.removeEventListener("touchend", onUp);
                    };
                    window.addEventListener("touchmove", onMove, { passive: true });
                    window.addEventListener("touchend", onUp);
                }}
            />

            <div className={`vc-controls ${showControls ? "vc-show" : "vc-hide"}`}>
                <button className={`vc-btn ${isMuted ? "vc-btn-active" : ""}`} onClick={toggleMute}>
                    {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                </button>
                <button className="vc-btn vc-btn-end" onClick={endCall}>
                    <MdCallEnd />
                </button>
                <button className={`vc-btn ${isCameraOff ? "vc-btn-active" : ""}`} onClick={toggleCamera}>
                    {isCameraOff ? <FaVideoSlash /> : <FaVideo />}
                </button>
                <button className="vc-btn" onClick={flipCamera} title="Flip Camera">
                    <FaCameraRotate />
                </button>
            </div>
        </div>
    );
};

export default VideoCall;
