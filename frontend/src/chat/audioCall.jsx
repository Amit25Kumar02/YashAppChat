/* eslint-disable react-hooks/exhaustive-deps */
import { useRef, useEffect, useState } from "react";
import { socket } from "./socket";
import { FaMicrophoneSlash, FaMicrophone } from "react-icons/fa";
import { MdCallEnd } from "react-icons/md";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./audioCall.css";

const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ],
};

const APIURL = `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api`;

const AudioCall = () => {
    const pcRef = useRef(null);
    const localStreamRef = useRef(null);
    const pendingCandidates = useRef([]);
    const durationRef = useRef(null);

    const [callEstablished, setCallEstablished] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [callDuration, setCallDuration] = useState(0);
    const [callerName, setCallerName] = useState("");

    const { receiverId } = useParams();
    const [searchParams] = useSearchParams();
    const role = searchParams.get("role") || "caller";
    const name = searchParams.get("name") || "";
    const navigate = useNavigate();

    useEffect(() => { setCallerName(name); }, [name]);

    const getPC = () => pcRef.current;

    const setupPC = () => {
        if (pcRef.current) pcRef.current.close();
        const pc = new RTCPeerConnection(ICE_SERVERS);
        pc.ontrack = (e) => {
            if (e.streams[0]) {
                const audio = new Audio();
                audio.srcObject = e.streams[0];
                audio.play().catch(() => {});
                setCallEstablished(true);
            }
        };
        pc.onicecandidate = (e) => {
            if (e.candidate) socket.emit("audio-ice-candidate", { to: receiverId, candidate: e.candidate });
        };
        pc.onconnectionstatechange = () => {
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
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = stream;
            stream.getTracks().forEach(t => getPC()?.addTrack(t, stream));
            return stream;
        } catch {
            toast.error("Microphone access denied.");
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
        if (notify) socket.emit("audio-call-ended", { to: receiverId });
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
                try {
                    const offer = await getPC().createOffer();
                    await getPC().setLocalDescription(offer);
                    socket.emit("audio-offer", { to: receiverId, from: myId, sdp: offer });
                } catch (err) {
                    console.error("Error creating audio offer:", err);
                }
            }
        };

        const handleOffer = async ({ from, sdp }) => {
            if (!mounted) return;
            try {
                await getPC().setRemoteDescription(new RTCSessionDescription(sdp));
                for (const c of pendingCandidates.current) await getPC().addIceCandidate(new RTCIceCandidate(c));
                pendingCandidates.current = [];
                const answer = await getPC().createAnswer();
                await getPC().setLocalDescription(answer);
                socket.emit("audio-answer", { to: receiverId, sdp: answer });
            } catch (err) {
                console.error("Error handling audio offer:", err);
            }
        };

        const handleAnswer = async ({ sdp }) => {
            if (!mounted) return;
            try {
                await getPC().setRemoteDescription(new RTCSessionDescription(sdp));
                for (const c of pendingCandidates.current) await getPC().addIceCandidate(new RTCIceCandidate(c));
                pendingCandidates.current = [];
                setCallEstablished(true);
            } catch (err) {
                console.error("Error handling audio answer:", err);
            }
        };

        const handleIce = async ({ candidate }) => {
            if (!mounted || !candidate) return;
            try {
                if (getPC()?.remoteDescription?.type) await getPC().addIceCandidate(new RTCIceCandidate(candidate));
                else pendingCandidates.current.push(candidate);
            } catch {}
        };

        const handleCallEnded = () => {
            if (!mounted) return;
            toast.info("Call ended.");
            cleanup(false);
            navigate("/chat");
        };

        socket.on("audio-offer", handleOffer);
        socket.on("audio-answer", handleAnswer);
        socket.on("audio-ice-candidate", handleIce);
        socket.on("audio-call-ended", handleCallEnded);

        init();

        return () => {
            mounted = false;
            socket.off("audio-offer", handleOffer);
            socket.off("audio-answer", handleAnswer);
            socket.off("audio-ice-candidate", handleIce);
            socket.off("audio-call-ended", handleCallEnded);
            cleanup(false);
        };
    }, []);

    useEffect(() => {
        if (callEstablished) {
            durationRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
        }
        return () => clearInterval(durationRef.current);
    }, [callEstablished]);

    const formatDuration = (s) => {
        const m = Math.floor(s / 60), sec = s % 60;
        return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    };

    const endCall = () => {
        const duration = callDuration;
        cleanup(true);
        const myId = localStorage.getItem("myUserId");
        const content = duration > 0
            ? `📞 Audio call ended • ${formatDuration(duration)}`
            : `📞 Missed audio call`;
        fetch(`${APIURL}/chat/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
            body: JSON.stringify({ sender: myId, receiver: receiverId, content, type: "call" }),
        }).then(r => r.json()).then(saved => socket.emit("sendMessage", saved)).catch(() => {});
        navigate("/chat");
    };

    const toggleMute = () => {
        const tracks = localStreamRef.current?.getAudioTracks();
        if (tracks?.length) { tracks[0].enabled = !tracks[0].enabled; setIsMuted(p => !p); }
    };

    const initial = callerName?.charAt(0)?.toUpperCase() || "?";

    return (
        <div className="ac-container">
            <div className="ac-card">
                <div className="ac-avatar">{initial}</div>
                <h2 className="ac-name">{callerName || "Unknown"}</h2>
                <p className="ac-status">
                    {callEstablished ? formatDuration(callDuration) : (role === "caller" ? "Calling..." : "Connecting...")}
                </p>
                {callEstablished && <div className="ac-wave"><span /><span /><span /><span /><span /></div>}
            </div>
            <div className="ac-controls">
                <button className={`ac-btn ${isMuted ? "ac-btn-muted" : ""}`} onClick={toggleMute} title={isMuted ? "Unmute" : "Mute"}>
                    {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                </button>
                <button className="ac-btn ac-btn-end" onClick={endCall} title="End Call">
                    <MdCallEnd />
                </button>
            </div>
        </div>
    );
};

export default AudioCall;
