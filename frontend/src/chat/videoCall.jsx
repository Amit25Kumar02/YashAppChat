/* eslint-disable react-hooks/exhaustive-deps */
import { useRef, useEffect, useState } from "react";
import { socket } from "./socket";
import "./videocall.css";
import {
    FaPhone,
    FaSync,
    FaMicrophoneSlash,
    FaMicrophone,
    FaTimes,
    FaVideoSlash,
    FaVideo,
} from "react-icons/fa";
import { useParams, useNavigate } from "react-router-dom";
import API from "./axiosInstance";
import { toast } from "react-toastify";

const VideoCall = () => {
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const peerConnection = useRef(null);
    const localStream = useRef(null);

    const [callEstablished, setCallEstablished] = useState(false);
    const [isFrontCamera, setIsFrontCamera] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [isSelfViewDragging, setIsSelfViewDragging] = useState(false);
    const [position, setPosition] = useState({ x: 20, y: 20 });
    const { receiverId } = useParams();
    const navigate = useNavigate();

    const [callDuration, setCallDuration] = useState(0);
    const durationIntervalRef = useRef(null);
    const earlyCandidates = useRef([]);

    const [isCaller, setIsCaller] = useState(true);
    const [isCameraOff, setIsCameraOff] = useState(false);

    useEffect(() => {
        // Create PeerConnection instance
        peerConnection.current = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        peerConnection.current.ontrack = (event) => {
            console.log("Remote stream received:", event.streams[0]);
            if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== event.streams[0]) {
                remoteVideoRef.current.srcObject = event.streams[0];
                setCallEstablished(true);
            }
        };

        peerConnection.current.onicecandidate = (event) => {
            if (event.candidate) {
                console.log("Sending ICE candidate:", event.candidate);
                socket.emit("ice-candidate", {
                    to: receiverId,
                    candidate: event.candidate,
                });
            }
        };

        const handleOffer = async ({ from, sdp }) => {
            console.log("Received offer:", sdp);
            setIsCaller(false);
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(sdp));
            earlyCandidates.current.forEach((candidate) => {
                peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
            });
            earlyCandidates.current = [];

            const answer = await peerConnection.current.createAnswer();
            await peerConnection.current.setLocalDescription(answer);
            socket.emit("answer", { to: from, sdp: answer });
        };

        const handleAnswer = async ({ sdp }) => {
            console.log("Received answer:", sdp);
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(sdp));
            earlyCandidates.current.forEach((candidate) => {
                peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
            });
            earlyCandidates.current = [];
            setCallEstablished(true); // <-- FIX: Trigger the timer when the answer is received
        };

        const handleIceCandidate = ({ candidate }) => {
            console.log("Received ICE candidate:", candidate);
            if (peerConnection.current.remoteDescription) {
                peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                earlyCandidates.current.push(candidate);
            }
        };

        const handleCallEnded = () => {
            console.log("Call ended by peer.");
            toast.info("Call ended by other user.");
            endCall();
        };

        socket.on("offer", handleOffer);
        socket.on("answer", handleAnswer);
        socket.on("ice-candidate", handleIceCandidate);
        socket.on("call-ended", handleCallEnded);

        startLocalStream();

        return () => {
            socket.off("offer", handleOffer);
            socket.off("answer", handleAnswer);
            socket.off("ice-candidate", handleIceCandidate);
            socket.off("call-ended", handleCallEnded);
            endCall();
        };
    }, [receiverId, navigate]);

    useEffect(() => {
        if (callEstablished) {
            durationIntervalRef.current = setInterval(() => {
                setCallDuration((prev) => prev + 1);
            }, 1000);
        } else {
            clearInterval(durationIntervalRef.current);
            setCallDuration(0);
        }
        return () => clearInterval(durationIntervalRef.current);
    }, [callEstablished]);

    const startLocalStream = async () => {
        try {
            if (localStream.current) {
                localStream.current.getTracks().forEach(track => track.stop());
            }
            const constraints = {
                video: { facingMode: isFrontCamera ? "user" : "environment" },
                audio: true,
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            localStream.current = stream;
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            peerConnection.current.getSenders().forEach(sender => {
                if (sender.track) peerConnection.current.removeTrack(sender);
            });
            stream.getTracks().forEach((track) => {
                peerConnection.current.addTrack(track, stream);
            });
        } catch (error) {
            console.error("Error accessing camera:", error);
            toast.error("Could not access camera/microphone.");
        }
    };

    const startCall = async () => {
        console.log("Starting call...");
        if (!localStream.current) {
            await startLocalStream();
        }

        const offer = await peerConnection.current.createOffer();
        await peerConnection.current.setLocalDescription(offer);
        socket.emit("offer", { to: receiverId, sdp: offer });
    };

    const endCall = () => {
        if (peerConnection.current) {
            peerConnection.current.getSenders().forEach(sender => {
                if (sender.track) sender.track.stop();
            });
            peerConnection.current.close();
            peerConnection.current = null;
        }
        if (localStream.current) {
            localStream.current.getTracks().forEach(track => track.stop());
        }
        setCallEstablished(false);
        socket.emit("call-ended", { to: receiverId });
        navigate("/chat");
    };

    const flipCamera = async () => {
        setIsFrontCamera((prev) => !prev);
        startLocalStream();
    };

    const toggleMute = () => {
        const audioTracks = localStream.current?.getAudioTracks();
        if (audioTracks?.length > 0) {
            const isCurrentlyMuted = !audioTracks[0].enabled;
            audioTracks[0].enabled = isCurrentlyMuted;
            setIsMuted(isCurrentlyMuted);
        }
    };

    const toggleCamera = () => {
        const videoTracks = localStream.current?.getVideoTracks();
        if (videoTracks?.length > 0) {
            const isCurrentlyOff = !videoTracks[0].enabled;
            videoTracks[0].enabled = isCurrentlyOff;
            setIsCameraOff(isCurrentlyOff);
        }
    };

    const handleDragStart = (e) => {
        e.preventDefault();
        setIsSelfViewDragging(true);
    };

    const handleDragEnd = () => {
        setIsSelfViewDragging(false);
    };

    const handleDragging = (e) => {
        if (!isSelfViewDragging) return;
        setPosition({ x: e.clientX, y: e.clientY });
    };

    const formatTime = (seconds) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [h, m, s].map((v) => (v < 10 ? "0" + v : v)).join(":");
    };

    return (
        <div className="video-container" onMouseMove={handleDragging} onMouseUp={handleDragEnd}>
            <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
            <video
                ref={localVideoRef}
                className="local-video"
                autoPlay
                playsInline
                muted
                style={{ left: `${position.x - 75}px`, top: `${position.y - 50}px` }}
                onMouseDown={handleDragStart}
            />
            {callEstablished && (
                <div className="call-timer">
                    <p>{formatTime(callDuration)}</p>
                </div>
            )}

            <div className="controls">
                {!callEstablished && isCaller && (
                    <button onClick={startCall} className="icon-btn start-call-btn">
                        <FaPhone />
                    </button>
                )}
                {callEstablished && (
                    <>
                        <button onClick={endCall} className="icon-btn end-call">
                            <FaTimes />
                        </button>
                        <button onClick={flipCamera} className="icon-btn">
                            <FaSync />
                        </button>
                        <button onClick={toggleMute} className="icon-btn">
                            {isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                        </button>
                        <button onClick={toggleCamera} className="icon-btn">
                            {isCameraOff ? <FaVideoSlash /> : <FaVideo />}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default VideoCall;