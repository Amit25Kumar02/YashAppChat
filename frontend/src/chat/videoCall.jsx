/* eslint-disable react-hooks/exhaustive-deps */
import { useRef, useEffect, useState } from "react";
import { socket } from "./socket";
import "./videocall.css";
import { FaMicrophoneSlash, FaMicrophone, FaVideoSlash, FaVideo } from "react-icons/fa";
import { MdCallEnd } from "react-icons/md";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
    ],
};

const APIURL = `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api`;

const VideoCall = () => {
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const pendingCandidates = useRef([]);

    const [callEstablished, setCallEstablished] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [callDuration, setCallDuration] = useState(0);
    const [hasRemoteStream, setHasRemoteStream] = useState(false);
    const durationRef = useRef(null);

    const { receiverId } = useParams();
    const [searchParams] = useSearchParams();
    // role=caller means this user initiated the call
    // role=receiver means this user accepted the call
    const role = searchParams.get("role") || "caller";
    const navigate = useNavigate();

    const getPC = () => pcRef.current;

    const setupPC = () => {
        if (pcRef.current) {
            pcRef.current.close();
        }
        const pc = new RTCPeerConnection(ICE_SERVERS);

        pc.ontrack = (e) => {
            console.log("🎥 Remote track received");
            if (remoteVideoRef.current && e.streams[0]) {
                remoteVideoRef.current.srcObject = e.streams[0];
                setHasRemoteStream(true);
                setCallEstablished(true);
            }
        };

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                console.log("🧊 Sending ICE candidate to", receiverId);
                socket.emit("ice-candidate", { to: receiverId, candidate: e.candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            console.log("🔗 Connection state:", pc.connectionState);
            if (pc.connectionState === "failed") {
                toast.error("Connection failed.");
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
            pcRef.current.close();
            pcRef.current = null;
        }
        if (notify) socket.emit("call-ended", { to: receiverId });
    };

    useEffect(() => {
        let mounted = true;

        // Re-register socket so onlineUsers map is fresh on this page
        const myId = localStorage.getItem("myUserId");
        if (myId) socket.emit("user-online", myId);

        const init = async () => {
            setupPC();
            await getLocalStream();
            if (!mounted) return;

            if (role === "caller") {
                // Small delay to ensure receiver's socket is registered
                await new Promise(r => setTimeout(r, 800));
                if (!mounted) return;
                console.log("📞 Role: CALLER — creating offer for", receiverId);
                try {
                    const offer = await getPC().createOffer();
                    await getPC().setLocalDescription(offer);
                    socket.emit("offer", { to: receiverId, from: myId, sdp: offer });
                    console.log("📤 Offer sent");
                } catch (err) {
                    console.error("❌ Error creating offer:", err);
                }
            } else {
                console.log("📞 Role: RECEIVER — waiting for offer from", receiverId);
            }
        };

        const handleOffer = async ({ from, sdp }) => {
            if (!mounted) return;
            console.log("📥 Offer received from", from);
            try {
                await getPC().setRemoteDescription(new RTCSessionDescription(sdp));
                // Flush pending ICE candidates
                for (const c of pendingCandidates.current) {
                    await getPC().addIceCandidate(new RTCIceCandidate(c));
                }
                pendingCandidates.current = [];
                const answer = await getPC().createAnswer();
                await getPC().setLocalDescription(answer);
                // Send answer back to caller using their user ID
                socket.emit("answer", { to: receiverId, sdp: answer });
                console.log("📤 Answer sent to", receiverId);
            } catch (err) {
                console.error("❌ Error handling offer:", err);
            }
        };

        const handleAnswer = async ({ sdp }) => {
            if (!mounted) return;
            console.log("📥 Answer received");
            try {
                await getPC().setRemoteDescription(new RTCSessionDescription(sdp));
                for (const c of pendingCandidates.current) {
                    await getPC().addIceCandidate(new RTCIceCandidate(c));
                }
                pendingCandidates.current = [];
                setCallEstablished(true);
            } catch (err) {
                console.error("❌ Error handling answer:", err);
            }
        };

        const handleIceCandidate = async ({ candidate }) => {
            if (!mounted || !candidate) return;
            try {
                if (getPC()?.remoteDescription?.type) {
                    await getPC().addIceCandidate(new RTCIceCandidate(candidate));
                } else {
                    pendingCandidates.current.push(candidate);
                }
            } catch (err) {
                console.error("❌ ICE candidate error:", err);
            }
        };

        const handleCallEnded = () => {
            if (!mounted) return;
            toast.info("Call ended by other user.");
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
        };
    }, []);

    useEffect(() => {
        if (callEstablished) {
            durationRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
        }
        return () => clearInterval(durationRef.current);
    }, [callEstablished]);

    const endCall = () => {
        const duration = callDuration;
        cleanup(true);
        // Save call ended message
        const myId = localStorage.getItem("myUserId");
        const content = duration > 0
            ? `📹 Video call ended • ${formatDuration(duration)}`
            : `📹 Video call ended`;
        fetch(`${APIURL}/chat/send`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({ sender: myId, receiver: receiverId, content, type: "call" }),
        })
        .then(r => r.json())
        .then(saved => socket.emit("sendMessage", saved))
        .catch(() => {});
        navigate("/chat");
    };

    const toggleMute = () => {
        const tracks = localStreamRef.current?.getAudioTracks();
        if (tracks?.length) {
            tracks[0].enabled = !tracks[0].enabled;
            setIsMuted(p => !p);
        }
    };

    const toggleCamera = () => {
        const tracks = localStreamRef.current?.getVideoTracks();
        if (tracks?.length) {
            tracks[0].enabled = !tracks[0].enabled;
            setIsCameraOff(p => !p);
        }
    };

    const formatDuration = (s) => {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        return [h, m, sec].map(v => String(v).padStart(2, "0")).join(":");
    };

    return (
        <div className="vc-container">
            <video ref={remoteVideoRef} className="vc-remote" autoPlay playsInline />

            {!hasRemoteStream && (
                <div className="vc-waiting">
                    <div className="vc-waiting-avatar">📞</div>
                    <p>{role === "caller" ? "Calling..." : "Connecting..."}</p>
                </div>
            )}

            {callEstablished && (
                <div className="vc-timer">{formatDuration(callDuration)}</div>
            )}

            <video ref={localVideoRef} className="vc-local" autoPlay playsInline muted />

            <div className="vc-controls">
                <button className={`vc-btn ${isMuted ? "vc-btn-active" : ""}`} onClick={toggleMute}>
                    {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                </button>
                <button className="vc-btn vc-btn-end" onClick={endCall}>
                    <MdCallEnd />
                </button>
                <button className={`vc-btn ${isCameraOff ? "vc-btn-active" : ""}`} onClick={toggleCamera}>
                    {isCameraOff ? <FaVideoSlash /> : <FaVideo />}
                </button>
            </div>
        </div>
    );
};

export default VideoCall;
