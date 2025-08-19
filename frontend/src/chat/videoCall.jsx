/* eslint-disable react-hooks/exhaustive-deps */
import { useRef, useEffect, useState } from "react";
import { socket } from "./socket.jsx";
import "./videocall.css";
import {
  FaPhone,
  FaSync,
  FaMicrophoneSlash,
  FaMicrophone,
  FaVideo,
  FaVideoSlash,
  FaTimes,
} from "react-icons/fa";
import { useParams, useNavigate } from "react-router-dom";
import API from "./axiosInstance";

const VideoCall = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const [callStarted, setCallStarted] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isSelfViewDragging, setIsSelfViewDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const { receiverId } = useParams();
  const navigate = useNavigate();

  const [callDuration, setCallDuration] = useState(0);
  const durationIntervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const earlyCandidates = useRef([]); // A queue to store early ICE candidates

  const [userProfile, setUserProfile] = useState(null);
  const [isCaller, setIsCaller] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await API.get("/auth/me");
        setUserProfile(res.data);
      } catch (error) {
        console.error("Failed to fetch user profile:", error);
        navigate("/");
      }
    };
    fetchProfile();
  }, []);

  useEffect(() => {
    if (!userProfile) return;

    peerConnection.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    peerConnection.current.ontrack = (event) => {
      if (remoteVideoRef.current.srcObject !== event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        remoteVideoRef.current.play().catch(() => {});
        setCallStarted(true);
      }
    };

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          to: receiverId,
          candidate: event.candidate,
        });
      }
    };

    const handleOffer = async ({ from, sdp }) => {
      setIsCaller(false);
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );
      earlyCandidates.current.forEach((candidate) => {
        peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      });
      earlyCandidates.current = [];

      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      socket.emit("answer", { to: from, sdp: answer });
    };

    const handleAnswer = async ({ sdp }) => {
      clearTimeout(timeoutRef.current);
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );
      earlyCandidates.current.forEach((candidate) => {
        peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      });
      earlyCandidates.current = [];
      setCallStarted(true);
    };

    const handleIceCandidate = ({ candidate }) => {
      if (peerConnection.current.remoteDescription) {
        peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        earlyCandidates.current.push(candidate);
      }
    };

    const handleCallEnded = () => {
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      clearInterval(durationIntervalRef.current);
      navigate("/chat");
    };

    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);
    socket.on("call-ended", handleCallEnded);

    // Start local camera immediately
    startLocalStream().then(() => {
      setCallStarted(true); // show self-view immediately
    });

    return () => {
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("call-ended", handleCallEnded);
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      clearInterval(durationIntervalRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, [receiverId, navigate, userProfile]);

  useEffect(() => {
    if (callStarted) {
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      clearInterval(durationIntervalRef.current);
    };
  }, [callStarted]);

  const startLocalStream = async () => {
    try {
      const constraints = {
        video: { facingMode: isFrontCamera ? "user" : "environment" },
        audio: true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localVideoRef.current.srcObject = stream;

      // Ensure local video starts playing
      if (localVideoRef.current) {
        await localVideoRef.current
          .play()
          .catch((e) => console.error("Local play error:", e));
      }

      const existingSenders = peerConnection.current.getSenders();
      existingSenders.forEach((sender) => {
        if (sender.track && sender.track.kind === "video") {
          peerConnection.current.removeTrack(sender);
        }
      });

      stream.getTracks().forEach((track) => {
        peerConnection.current.addTrack(track, stream);
      });
    } catch (error) {
      console.error("Error accessing camera:", error);
    }
  };

  const startCall = async () => {
    if (callStarted) return;

    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    socket.emit("offer", { to: receiverId, sdp: offer });

    timeoutRef.current = setTimeout(() => {
      console.log("Call timed out. Assuming missed call.");
      socket.emit("missedCall", {
        callerId: userProfile._id,
        receiverId: receiverId,
      });
      endCall();
    }, 30000);
  };

  const endCall = () => {
    clearInterval(durationIntervalRef.current);
    clearTimeout(timeoutRef.current);

    if (userProfile && receiverId) {
      socket.emit("saveCallHistory", {
        sender: userProfile._id,
        receiver: receiverId,
        content: "Video Call",
        callDuration: callDuration,
        callEndedAt: new Date(),
      });
    }

    if (peerConnection.current) {
      peerConnection.current.close();
    }
    socket.emit("call-ended", { to: receiverId });
    navigate("/chat");
  };

  const flipCamera = async () => {
    const stream = localVideoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    setIsFrontCamera((prev) => !prev);

    setTimeout(() => {
      startLocalStream();
    }, 100);
  };

  const toggleMute = () => {
    const stream = localVideoRef.current.srcObject;
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].enabled = !audioTracks[0].enabled;
        setIsMuted(!audioTracks[0].enabled);
      }
    }
  };

  const handleDragStart = () => {
    setIsSelfViewDragging(true);
  };

  const handleDragEnd = () => {
    setIsSelfViewDragging(false);
  };

  const handleDragging = (e) => {
    if (!isSelfViewDragging) return;
    setPosition({ x: e.clientX - 75, y: e.clientY - 50 });
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map((v) => (v < 10 ? "0" + v : v)).join(":");
  };

  return (
    <div className="video-container">
      <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
      <video
        ref={localVideoRef}
        className="local-video"
        autoPlay
        playsInline
        muted
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragging}
        onMouseUp={handleDragEnd}
      />
      {callStarted && (
        <div className="call-timer">
          <p>{formatTime(callDuration)}</p>
        </div>
      )}

      <div className="controls">
        {!callStarted && isCaller && (
          <button onClick={startCall} className="icon-btn start-call-btn">
            <FaPhone />
          </button>
        )}
        {callStarted && (
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
          </>
        )}
      </div>
    </div>
  );
};

export default VideoCall;
