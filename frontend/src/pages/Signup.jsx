import { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "react-router-dom";
import { toast, ToastContainer } from "react-toastify";
import 'react-toastify/dist/ReactToastify.css';
import { FiEye, FiEyeOff } from "react-icons/fi";
import './signup.css'; // Make sure this CSS file exists

const Signup = () => {
    const [user, setUser] = useState({
        username: "",
        phoneNumber: "",
        email: "",
        password: "",
        confirmPassword: "",
    });

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const navigate = useNavigate();

    const handleChange = (e) => {
        setUser({ ...user, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!user.username || !user.phoneNumber || !user.email || !user.password || !user.confirmPassword) {
            toast.error("Please fill in all fields.");
            return;
        }

        if (user.password !== user.confirmPassword) {
            toast.error("Passwords do not match.");
            return;
        }

        try {
            const res = await axios.post("http://localhost:4000/api/auth", user);
            toast.success("Signup successful! Please login.");
            navigate("/");
            setUser({
                username: "",
                phoneNumber: "",
                email: "",
                password: "",
                confirmPassword: "",
            });
            console.log(res.data.message);
        } catch (err) {
            toast.error(err.response?.data?.message || "Signup failed. Please try again.");
        }
    };

    const togglePasswordVisibility = () => {
        setShowPassword(!showPassword);
    };

    const toggleConfirmPasswordVisibility = () => {
        setShowConfirmPassword(!showConfirmPassword);
    };

    return (
        <div className="signup-container">
            <div className="signup-card">
                <h2 className="signup-title">Create an Account</h2>
                <p className="signup-subtitle">Join us and start connecting with your friends.</p>
                <form onSubmit={handleSubmit}>
                    <div className="input-group-custom">
                        <label className="input-label">UserName</label>
                        <input
                            type="text"
                            name="username"
                            className="signup-input"
                            value={user.username}
                            onChange={handleChange}
                            placeholder="e.g., JohnDoe"
                        />
                    </div>

                    <div className="input-group-custom">
                        <label className="input-label">Phone Number</label>
                        <input
                            type="number"
                            name="phoneNumber"
                            className="signup-input"
                            value={user.phoneNumber}
                            onChange={handleChange}
                            placeholder="e.g., 9876543210"
                        />
                    </div>

                    <div className="input-group-custom">
                        <label className="input-label">Email</label>
                        <input
                            type="email"
                            name="email"
                            className="signup-input"
                            value={user.email}
                            onChange={handleChange}
                            placeholder="e.g., example@gmail.com"
                        />
                    </div>

                    <div className="input-group-custom">
                        <label className="input-label">Password</label>
                        <div className="password-input-wrapper">
                            <input
                                type={showPassword ? "text" : "password"}
                                name="password"
                                className="signup-input"
                                value={user.password}
                                onChange={handleChange}
                                placeholder="Enter your password"
                            />
                            <span className="password-toggle-icon" onClick={togglePasswordVisibility}>
                                {showPassword ? <FiEyeOff /> : <FiEye />}
                            </span>
                        </div>
                    </div>

                    <div className="input-group-custom">
                        <label className="input-label">Confirm Password</label>
                        <div className="password-input-wrapper">
                            <input
                                type={showConfirmPassword ? "text" : "password"}
                                name="confirmPassword"
                                className="signup-input"
                                value={user.confirmPassword}
                                onChange={handleChange}
                                placeholder="Confirm your password"
                            />
                            <span className="password-toggle-icon" onClick={toggleConfirmPasswordVisibility}>
                                {showConfirmPassword ? <FiEyeOff /> : <FiEye />}
                            </span>
                        </div>
                    </div>

                    <button type="submit" className="signup-button">Sign Up</button>
                </form>

                <p className="login-link">
                    Already have an account? <Link to="/">Log In</Link>
                </p>
            </div>
            <ToastContainer />
        </div>
    );
};

export default Signup;