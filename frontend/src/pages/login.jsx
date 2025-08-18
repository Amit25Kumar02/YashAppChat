/* eslint-disable no-unused-vars */
import { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import AuthContext from "../chat/authContext";
import axios from "axios";
import { toast, ToastContainer } from "react-toastify";
import 'react-toastify/dist/ReactToastify.css';
import { FiEye, FiEyeOff } from "react-icons/fi";
import './login.css'; // Import the new CSS file

const Login = () => {
    const { setUser } = useContext(AuthContext);
    const [phoneNumber, setPhoneNumber] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();

        if (!phoneNumber || !password) {
            toast.error("Please fill in all fields.");
            return;
        }

        try {
            const res = await axios.post("http://localhost:4000/api/auth/login", { phoneNumber, password });
            localStorage.setItem("token", res.data.token);
            localStorage.setItem("user", JSON.stringify(res.data.user));
            setUser(res.data.user);
            toast.success("Login successful!");
            navigate("/chat");
        } catch (error) {
            toast.error("Login failed! Please check your information.");
        }
    };

    const togglePasswordVisibility = () => {
        setShowPassword(!showPassword);
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <h2 className="login-title">Welcome Back</h2>
                <p className="login-subtitle">Log in to your account to continue.</p>
                <form onSubmit={handleLogin}>
                    <div className="input-group-custom">
                        <label className="input-label">Phone Number</label>
                        <input
                            type="number"
                            className="login-input"
                            placeholder="Enter Phone Number"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                        />
                    </div>

                    <div className="input-group-custom">
                        <label className="input-label">Password</label>
                        <div className="password-input-wrapper">
                            <input
                                type={showPassword ? "text" : "password"}
                                className="login-input"
                                placeholder="Enter Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <span className="password-toggle-icon" onClick={togglePasswordVisibility}>
                                {showPassword ? <FiEyeOff /> : <FiEye />}
                            </span>
                        </div>
                    </div>

                    <button type="submit" className="login-button">Log In</button>
                </form>

                <p className="signup-link">
                    New user? <Link to="/signup">Sign up</Link>
                </p>
            </div>
            <ToastContainer />
        </div>
    );
};

export default Login;