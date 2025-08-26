/* eslint-disable react-hooks/exhaustive-deps */
import { useRef, useEffect, useState } from "react";
import { socket } from "./socket.jsx";
import "./videocall.css";
import {
  FaPhone,
  FaSync,
  FaMicrophoneSlash,
  FaMicrophone,
  FaTimes,
} from "react-icons/fa";
import { useParams, useNavigate } from "react-router-dom";
import API from "./axiosInstance";

const VideoCall = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnection = useRef(null);
  const [callEstablished, setCallEstablished] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isSelfViewDragging, setIsSelfViewDragging] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const { receiverId } = useParams();
  const navigate = useNavigate();

  const [callDuration, setCallDuration] = useState(0);
  const durationIntervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const earlyCandidates = useRef([]);

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
      console.log("Remote stream received:", event.streams[0]);
      if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        remoteVideoRef.current.play().catch(e => console.error("Remote play error:", e));
        setCallEstablished(true);
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
      setCallEstablished(true);
    };

    const handleAnswer = async ({ sdp }) => {
      console.log("Received answer:", sdp);
      clearTimeout(timeoutRef.current);
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(sdp));
      earlyCandidates.current.forEach((candidate) => {
        peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      });
      earlyCandidates.current = [];
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
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      clearInterval(durationIntervalRef.current);
      clearTimeout(timeoutRef.current);
    };
  }, [receiverId, navigate, userProfile]);

  useEffect(() => {
    if (callEstablished) {
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      clearInterval(durationIntervalRef.current);
    };
  }, [callEstablished]);

  const startLocalStream = async () => {
    try {
      const constraints = {
        video: { facingMode: isFrontCamera ? "user" : "environment" },
        audio: true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localVideoRef.current.srcObject = stream;
      if (localVideoRef.current) {
        localVideoRef.current.play().catch(e => console.error("Local play error:", e));
      }

      // Add tracks to the peer connection
      const existingSenders = peerConnection.current.getSenders();
      existingSenders.forEach(sender => {
        if (sender.track) {
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
    if (callEstablished) return;

    // Await for tracks to be added before creating offer
    await new Promise(resolve => setTimeout(resolve, 500));

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
    setCallEstablished(false);

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
      peerConnection.current = null;
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
    startLocalStream();
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
          </>
        )}
      </div>
    </div>
  );
};

export default VideoCall;