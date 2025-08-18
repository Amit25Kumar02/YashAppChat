import { BrowserRouter, Route, Routes } from "react-router-dom";
import Signup from "./pages/signup";
import Login from "./pages/login";
import Chat from "./chat/chat";
import VideoCall from "./chat/videoCall";
import { AuthProvider } from "./chat/authContext";
// import "bootstrap/dist/css/bootstrap.min.css"; 

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/chat" element={<Chat />} />
                    <Route path="/video/:receiverId" element={<VideoCall />} />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
