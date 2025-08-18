// src/chat/axiosInstance.js
import axios from 'axios';

const API = axios.create({
    baseURL: 'http://localhost:4000/api',
});

// Request interceptor to add the auth token to headers
API.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

export default API;