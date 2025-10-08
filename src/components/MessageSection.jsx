'use client'

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from '../contexts/TranslationContext';
import CallButtons from './CallButtons';

const MessageSection = ({
    selectedUser,
    selectedRoom,
    messages,
    message,
    setMessage,
    sendMessage,
    handleFileChange,
    isTyping,
    user,
    startCall,
    startGroupCall,
    formatTime,
    onManageGroup
}) => {
    const { t, translateText, translateTexts, currentLanguage } = useTranslation();
    const fileInputRef = useRef(null);
    const messageInputRef = useRef(null);
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    
    // Track translated messages
    const [translatedMessages, setTranslatedMessages] = useState(new Map());
    const [visibleMessageIds, setVisibleMessageIds] = useState(new Set());
    const observerRef = useRef(null);
    const inFlightRef = useRef(new Set()); // track messageIds currently being translated
    const translateTimerRef = useRef(null);

    // Debug logging
    useEffect(() => {
        // console.log('MessageSection re-rendered with:', {
        //     selectedUser: selectedUser?.name,
        //     selectedRoom: selectedRoom?.name,
        //     user: user?.username,
        //     onManageGroup: !!onManageGroup
        // });
    }, [selectedUser, selectedRoom, user, onManageGroup]);

    // Scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    // Lazy batch translation effect using translateTexts from context
    useEffect(() => {
        if (!messages.length || typeof window === 'undefined') return;

        // Debounced translator to coalesce rapid visible-id changes
        const scheduleTranslate = () => {
            if (translateTimerRef.current) clearTimeout(translateTimerRef.current);
            translateTimerRef.current = setTimeout(async () => {
                // Find visible messages that are not yet translated and not in-flight
                const messagesToTranslate = messages.filter(msg => {
                    const messageId = msg._id || msg.id;
                    return visibleMessageIds.has(messageId) && !translatedMessages.has(messageId) && !inFlightRef.current.has(messageId);
                });

                if (messagesToTranslate.length === 0) return;

                try {
                    // Mark as in-flight
                    messagesToTranslate.forEach(m => inFlightRef.current.add(m._id || m.id));

                    const texts = messagesToTranslate.map(m => m.content || '');
                    // Limit to 30 per call
                    const batch = texts.slice(0, 30);
                    const results = await translateTexts(batch, currentLanguage);

                    messagesToTranslate.slice(0, results.length).forEach((msg, idx) => {
                        const messageId = msg._id || msg.id;
                        const translatedContent = results[idx] || msg.content;
                        setTranslatedMessages(prev => new Map(prev).set(messageId, {
                            content: translatedContent,
                            originalContent: msg.content
                        }));
                        inFlightRef.current.delete(messageId);
                    });

                    // If there were more messages beyond the sliced 30, schedule another run
                    if (messagesToTranslate.length > results.length) {
                        scheduleTranslate();
                    }
                } catch (error) {
                    console.error('Batch translation failed:', error);
                    messagesToTranslate.forEach((msg) => {
                        const messageId = msg._id || msg.id;
                        setTranslatedMessages(prev => new Map(prev).set(messageId, {
                            content: msg.content,
                            originalContent: msg.content
                        }));
                        inFlightRef.current.delete(messageId);
                    });
                }
            }, 120); // 120ms debounce to coalesce quick events
        };

        scheduleTranslate();

        return () => {
            if (translateTimerRef.current) {
                clearTimeout(translateTimerRef.current);
                translateTimerRef.current = null;
            }
        };
    }, [messages, visibleMessageIds, currentLanguage, translateText, translateTexts, translatedMessages]);

    // Intersection Observer setup
    useEffect(() => {
        if (!messagesContainerRef.current || typeof window === 'undefined') return;

        const observerOptions = {
            root: messagesContainerRef.current,
            rootMargin: '50px', // Start loading 50px before messages come into view
            threshold: 0.1
        };

        observerRef.current = new IntersectionObserver((entries) => {
            const newVisibleIds = new Set(visibleMessageIds);
            let hasChanges = false;

            entries.forEach(entry => {
                const messageId = entry.target.dataset.messageId;
                if (entry.isIntersecting) {
                    if (!newVisibleIds.has(messageId)) {
                        newVisibleIds.add(messageId);
                        hasChanges = true;
                    }
                }
            });

            if (hasChanges) {
                setVisibleMessageIds(newVisibleIds);
            }
        }, observerOptions);

        // Observe all message elements
        const messageElements = messagesContainerRef.current.querySelectorAll('[data-message-id]');
        messageElements.forEach(el => {
            observerRef.current.observe(el);
        });

        // Scroll handler for pagination: when user scrolls to top, request more messages
        const handleScroll = async (e) => {
            const el = e.target;
            if (el.scrollTop <= 50) {
                // Fire a custom event so parent can load older messages
                const loadEvent = new CustomEvent('loadOlderMessages');
                window.dispatchEvent(loadEvent);
            }
        };

        messagesContainerRef.current.addEventListener('scroll', handleScroll);

        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
            if (messagesContainerRef.current) {
                messagesContainerRef.current.removeEventListener('scroll', handleScroll);
            }
        };
    }, [messages, visibleMessageIds]);

    // Reset translations when language changes
    useEffect(() => {
        setTranslatedMessages(new Map());
        setVisibleMessageIds(new Set());
    }, [currentLanguage]);

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <main className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Fixed header */}
            <div className="bg-white shadow-sm p-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                    {selectedUser && (
                        <div className="relative">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center text-lg font-semibold">
                                {selectedUser.avatar}
                            </div>
                            {selectedUser.status === 'online' && (
                                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                            )}
                        </div>
                    )}
                    <div>
                        <h2 className="text-lg font-semibold text-gray-800">
                            {selectedUser?.name || selectedRoom?.name || t('chat')}
                        </h2>
                        {selectedUser && (
                            <div className="text-sm text-gray-500">
                                {selectedUser.status === 'online' ? t('online') : t('offline')}
                            </div>
                        )}
                    </div>
                </div>
                {(selectedUser || selectedRoom) && (
                    <div className="flex items-center space-x-2">
                        {/* {console.log('MessageSection rendering - selectedRoom:', selectedRoom, 'onManageGroup:', !!onManageGroup)} */}
                        {selectedRoom && onManageGroup && (() => {
                            {/* console.log('MessageSection - selectedRoom:', selectedRoom);
                            console.log('MessageSection - user:', user);
                            console.log('MessageSection - onManageGroup:', !!onManageGroup);
                            console.log('MessageSection - room admins array:', selectedRoom.admins);
                            console.log('MessageSection - user id:', user?.id, 'user _id:', user?._id); */}
                            
                            // Temporarily always show for testing
                            const isAdmin = true; // selectedRoom.admins?.some(admin => {
                            //     const adminId = admin._id || admin;
                            //     const adminIdStr = adminId.toString();
                            //     const userIdStr = (user?.id || user?._id)?.toString();
                            //     const match = adminIdStr === userIdStr;
                            //     console.log('Checking admin:', adminIdStr, 'vs user:', userIdStr, 'match:', match);
                            //     return match;
                            // });
                            
                            {/* console.log('MessageSection - final isAdmin result:', isAdmin); */}
                            
                            return isAdmin ? (
                                <button
                                    onClick={() => {
                                        // console.log('Settings icon clicked in MessageSection');
                                        onManageGroup(selectedRoom);
                                    }}
                                    className="p-2 text-gray-500 hover:text-gray-700 rounded-full hover:bg-gray-100 transition-colors bg-red-100"
                                    title="Manage group"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </button>
                            ) : null;
                        })()}
                        <CallButtons
                            onAudioCall={() => {
                                if (selectedRoom && startGroupCall) {
                                    startGroupCall('audio');
                                } else if (startCall) {
                                    startCall('audio');
                                }
                            }}
                            onVideoCall={() => {
                                if (selectedRoom && startGroupCall) {
                                    startGroupCall('video');
                                } else if (startCall) {
                                    startCall('video');
                                }
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Scrollable messages container */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                {messages.map((msg, index) => {
                    const isCurrentUser = msg.sender?._id === user?._id || msg.sender === user?._id;
                    const messageId = msg._id || msg.id || `temp-${index}`;
                    const translatedMessage = translatedMessages.get(messageId);
                    const displayContent = translatedMessage ? translatedMessage.content : msg.content;
                    const isTranslated = translatedMessage && translatedMessage.originalContent !== translatedMessage.content;
                    
                    return (
                            <div
                                key={messageId}
                                data-message-id={messageId}
                                className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                            >
                            <div
                                className={`max-w-[70%] rounded-2xl px-4 py-3 ${
                                    isCurrentUser
                                        ? 'bg-emerald-500 text-white rounded-br-none'
                                        : 'bg-white text-gray-800 rounded-bl-none'
                                } shadow-md hover:shadow-lg transition-shadow duration-200`}
                            >
                                {/* Translation indicator */}
                                {isTranslated && !isCurrentUser && (
                                    <div className="flex items-center space-x-1 text-xs text-blue-600 mb-1 font-medium">
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M7 2a1 1 0 011 1v1h3a1 1 0 110 2H9.578a18.87 18.87 0 01-1.724 4.78c.29.354.596.696.914 1.026a1 1 0 11-1.44 1.389c-.188-.196-.373-.396-.554-.6a19.098 19.098 0 01-3.107 3.567 1 1 0 01-1.334-1.49 17.087 17.087 0 003.13-3.733 18.992 18.992 0 01-1.487-2.494 1 1 0 111.79-.89c.234.47.489.928.764 1.372.417-.934.752-1.913.997-2.927H3a1 1 0 110-2h3V3a1 1 0 011-1zm6 6a1 1 0 01.894.553l2.991 5.982a.869.869 0 01.02.037l.99 1.98a1 1 0 11-1.79.895L15.383 16h-4.764l-.724 1.447a1 1 0 11-1.788-.894l.99-1.98.019-.038 2.99-5.982A1 1 0 0113 8zm-1.382 6h2.764L13 11.236 11.618 14z" clipRule="evenodd" />
                                        </svg>
                                        <span>Translated</span>
                                    </div>
                                )}
                                
                                {/* Message content with enhanced readability */}
                                <div className="break-words text-[15px] leading-relaxed whitespace-pre-wrap">
                                    {displayContent}
                                </div>
                                
                                {/* Show original text on hover for translated messages */}
                                {isTranslated && translatedMessage.originalContent && (
                                    <div className="mt-2 pt-2 border-t border-gray-200/30">
                                        <div className="text-xs opacity-70 italic">
                                            Original: {translatedMessage.originalContent}
                                        </div>
                                    </div>
                                )}
                                
                                <div className={`text-[11px] mt-1 flex items-center justify-end space-x-1 ${
                                    isCurrentUser ? 'text-emerald-100' : 'text-gray-500'
                                }`}>
                                    <span>{formatTime ? formatTime(msg.timestamp) : new Date(msg.timestamp).toLocaleTimeString()}</span>
                                    {isCurrentUser && (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                
                {isTyping && selectedUser && (
                    <div className="flex items-center space-x-2 text-gray-500">
                        <div className="bg-white rounded-full p-4 shadow-md">
                            <div className="flex space-x-1">
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef}></div>
            </div>

            {/* Fixed input area at bottom */}
            <div className="bg-white p-4 shadow-lg">
                <form 
                    onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
                    className="flex items-center space-x-2"
                >
                    <label 
                        htmlFor="file-input"
                        className="p-2 text-gray-500 hover:text-gray-700 cursor-pointer hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                    </label>
                    <input
                        type="file"
                        id="file-input"
                        className="hidden"
                        onChange={handleFileChange}
                        ref={fileInputRef}
                    />
                    <div className="relative flex-1">
                        <input
                            type="text"
                            className="w-full rounded-full border border-gray-300 pl-4 pr-12 py-3 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                            placeholder={t('typeMessage')}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            onKeyPress={handleKeyPress}
                            ref={messageInputRef}
                        />
                        <button 
                            type="submit"
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-2 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 transition-colors shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                            </svg>
                        </button>
                    </div>
                </form>
            </div>
        </main>
    );
};

export default MessageSection;