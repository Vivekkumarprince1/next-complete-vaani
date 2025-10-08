 'use client'

import React, { useState } from 'react';
import { useTranslation } from '../contexts/TranslationContext';

const ContactList = ({ 
    users, 
    rooms, 
    selectedUser, 
    selectedRoom, 
    selectUser, 
    selectRoom, 
    createRoom, 
    showSidebar,
    onManageGroup,
    user 
}) => {
    const { t } = useTranslation();

    // Tabs state: show groups or contacts
    const [showGroups, setShowGroups] = useState(false);

    // Helper function to format last seen time
    const formatLastSeen = (lastSeen) => {
        if (!lastSeen) return '';
        
        const date = new Date(lastSeen);
        const now = new Date();
        const diffInMinutes = Math.floor((now - date) / (1000 * 60));
        
        if (diffInMinutes < 1) return 'Just now';
        if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
        if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hours ago`;
        if (diffInMinutes < 10080) return `${Math.floor(diffInMinutes / 1440)} days ago`;
        return date.toLocaleDateString();
    };

    return (
        <aside className={`fixed lg:static w-80 bg-white h-full z-20 transform transition-transform duration-300 ease-in-out ${showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} shadow-lg`}>
            <div className="flex flex-col h-full">
                <div className="p-4 bg-gray-50 border-b">
                    {/* Tabs: Contacts / Groups */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <button
                                className={`px-3 py-1 rounded-md text-sm font-semibold ${!showGroups ? 'text-gray-800' : 'text-gray-500'}`}
                                onClick={() => setShowGroups(false)}
                            >
                                {t('contacts')}
                            </button>
                            <button
                                className={`px-3 py-1 rounded-md text-sm font-semibold ${showGroups ? 'text-gray-800' : 'text-gray-500'}`}
                                onClick={() => setShowGroups(true)}
                            >
                                {t('groups')}
                            </button>
                        </div>
                        {/* Create group button only shown on Groups tab */}
                        {showGroups ? (
                            <button 
                                className="w-9 h-9 bg-emerald-600 text-white rounded-full flex items-center justify-center hover:bg-emerald-700 transition-colors shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95"
                                onClick={createRoom}
                                title="Create group"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>
                        ) : (
                            <div style={{ width: 36 }} />
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {/* Search bar */}
                    <div className="p-3">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search..."
                                className="w-full pl-10 pr-4 py-2 bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                    </div>

                    {/* Conditional: show Contacts or Groups */}
                    {!showGroups ? (
                        <div className="px-2">
                            <ul className="space-y-0.5">
                                {users.map(user => (
                                    <li
                                        key={user.id}
                                        className={`flex items-center p-3 rounded-xl cursor-pointer transition-all duration-200 hover:bg-gray-100 ${
                                            selectedUser?.id === user.id ? 'bg-emerald-50 hover:bg-emerald-100' : ''
                                        }`}
                                        onClick={() => selectUser(user)}
                                    >
                                        <div className="relative">
                                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center text-lg font-semibold shadow-md">
                                                {user.avatar}
                                            </div>
                                            {user.status === 'online' && (
                                                <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white"></div>
                                            )}
                                        </div>
                                        <div className="ml-3 flex-1">
                                            <div className="flex items-center justify-between">
                                                <div className="font-semibold text-gray-900">{user.name}</div>
                                                <div className="text-xs text-gray-500">
                                                    {user.status === 'online' ? t('online') : formatLastSeen(user.lastSeen)}
                                                </div>
                                            </div>
                                            <div className="text-sm text-gray-500 flex items-center space-x-1">
                                                {user.status === 'online' ? (
                                                    <>
                                                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                                        <span>{t('online')}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="w-2 h-2 bg-gray-300 rounded-full"></span>
                                                        <span>{t('offline')}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <div className="px-2 mt-4">
                            <ul className="space-y-0.5">
                                {rooms.map(room => {
                                    const isAdmin = room.admins?.some(admin => 
                                        admin.toString() === user?.id || admin._id?.toString() === user?.id
                                    );

                                    return (
                                    <li
                                        key={room._id}
                                        className={`flex items-center p-3 rounded-xl cursor-pointer transition-all duration-200 hover:bg-gray-100 ${
                                            selectedRoom?._id === room._id ? 'bg-emerald-50 hover:bg-emerald-100' : ''
                                        }`}
                                        onClick={() => selectRoom(room)}
                                    >
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white flex items-center justify-center text-lg font-semibold shadow-md">
                                            {room.name?.[0]?.toUpperCase() || 'G'}
                                        </div>
                                        <div className="ml-3 flex-1">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="font-semibold text-gray-900">{room.name}</div>
                                                    {isAdmin && (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                            Admin
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <div className="text-xs text-gray-500">{formatLastSeen(room.lastActivity)}</div>
                                                    {isAdmin && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onManageGroup(room);
                                                        }}
                                                        className="text-gray-500 hover:text-gray-700 p-2 rounded-full hover:bg-gray-200 transition-colors bg-red-100"
                                                        title="Manage group"
                                                    >
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                        </svg>
                                                    </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-sm text-gray-500">{room.participants?.length || 0} members</div>
                                        </div>
                                    </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
};

export default ContactList;