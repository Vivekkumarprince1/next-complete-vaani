'use client'

import React, { useState, useEffect } from 'react';
import socketManager from '../utils/socketManager';

/**
 * Socket connection status indicator
 */
const SocketStatus = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [showStatus, setShowStatus] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkConnection = () => {
      setIsConnected(socketManager.socket?.connected || false);
    };

    // Check initially
    checkConnection();

    // Check periodically
    const interval = setInterval(checkConnection, 2000);

    // Listen for socket events if available
    if (socketManager.socket) {
      socketManager.on('connect', () => {
        console.log('Socket connected');
        setIsConnected(true);
      });

      socketManager.on('disconnect', () => {
        console.log('Socket disconnected');
        setIsConnected(false);
      });
    }

    return () => {
      clearInterval(interval);
      if (socketManager.socket) {
        socketManager.off('connect');
        socketManager.off('disconnect');
      }
    };
  }, []);

  // Auto-hide if connected for more than 3 seconds
  useEffect(() => {
    if (isConnected) {
      const timer = setTimeout(() => setShowStatus(false), 3000);
      return () => clearTimeout(timer);
    } else {
      setShowStatus(true);
    }
  }, [isConnected]);

  if (!showStatus && isConnected) return null;

  return (
    <div 
      className={`fixed bottom-4 left-4 px-4 py-2 rounded-full shadow-lg z-40 flex items-center gap-2 transition-all ${
        isConnected 
          ? 'bg-green-500 text-white' 
          : 'bg-yellow-500 text-white'
      }`}
    >
      <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-white animate-pulse' : 'bg-white'}`} />
      <span className="text-sm font-medium">
        {isConnected ? 'Connected' : 'Connecting...'}
      </span>
      {isConnected && showStatus && (
        <button
          onClick={() => setShowStatus(false)}
          className="ml-2 text-white hover:text-gray-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default SocketStatus;
