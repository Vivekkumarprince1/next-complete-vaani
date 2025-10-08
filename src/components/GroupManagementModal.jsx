'use client'

import React, { useState, useEffect } from 'react';
import axios from 'axios';

const GroupManagementModal = ({ isOpen, onClose, room, users, currentUserId, onRoomUpdate }) => {
  // console.log('GroupManagementModal props:', { isOpen, room, users: users?.length, currentUserId });
  const [availableUsers, setAvailableUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

  useEffect(() => {
    if (isOpen && room) {
      // console.log('GroupManagementModal room data:', room);
      // console.log('GroupManagementModal users:', users);
      // console.log('GroupManagementModal currentUserId:', currentUserId);
      
      // Filter users who are not already in the group
      const currentMemberIds = room.participants?.map(p => p._id || p) || [];
      // console.log('Current member IDs:', currentMemberIds);
      
      const available = users.filter(user => !currentMemberIds.includes(user.id));
      // console.log('Available users:', available);
      
      setAvailableUsers(available);
    }
  }, [isOpen, room, users]);

  const isAdmin = room?.admins?.some(admin => {
    const adminId = admin._id || admin;
    const adminIdStr = adminId.toString();
    const currentUserIdStr = currentUserId?.toString();
    const isMatch = adminIdStr === currentUserIdStr;
    // console.log('Checking admin:', adminIdStr, 'vs currentUserId:', currentUserIdStr, 'match:', isMatch);
    return isMatch;
  });

  const handleAddMember = async () => {
    if (!selectedUserId) return;

    console.log('Adding member:', selectedUserId, 'to room:', room._id);
    console.log('Is admin?', isAdmin);

    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_URL}/chat/rooms/${room._id}/members`, {
        userId: selectedUserId
      }, {
        headers: { 'x-auth-token': token }
      });

      console.log('Add member response:', res.data);
      onRoomUpdate(res.data);
      setSelectedUserId('');
      // Update available users
      setAvailableUsers(prev => prev.filter(user => user.id !== selectedUserId));
    } catch (error) {
      console.error('Error adding member:', error);
      console.error('Error response:', error.response?.data);
      alert('Failed to add member: ' + (error.response?.data?.error || error.message));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMember = async (userId) => {
    if (userId === currentUserId) {
      if (!confirm('Are you sure you want to leave this group?')) return;
    } else {
      if (!confirm('Are you sure you want to remove this member?')) return;
    }

    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.delete(`${API_URL}/chat/rooms/${room._id}/members`, {
        headers: { 'x-auth-token': token },
        data: { userId }
      });

      onRoomUpdate(res.data);
      // If user left themselves, close modal
      if (userId === currentUserId) {
        onClose();
      }
    } catch (error) {
      console.error('Error removing member:', error);
      alert('Failed to remove member');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !room) {
    // console.log('GroupManagementModal not rendering - isOpen:', isOpen, 'hasRoom:', !!room);
    return null;
  }

  console.log('GroupManagementModal rendering for room:', room.name, 'isAdmin:', isAdmin);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Manage Group: {room.name}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            {/* Group Info */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-medium text-gray-900 mb-2">Group Information</h3>
              <p className="text-sm text-gray-600">
                <strong>Description:</strong> {room.description || 'No description'}
              </p>
              <p className="text-sm text-gray-600">
                <strong>Members:</strong> {room.participants?.length || 0}
              </p>
              <p className="text-sm text-gray-600">
                <strong>Created by:</strong> {room.createdBy?.username || 'Unknown'}
              </p>
            </div>

            {/* Add Member (Admin only) */}
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Add Member {isAdmin ? '(You are admin)' : '(You are not admin)'}</h3>
              {isAdmin ? (
                <div className="flex space-x-2">
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select a user... ({availableUsers.length} available)</option>
                    {availableUsers.map(user => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddMember}
                    disabled={!selectedUserId || isLoading}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Only group admins can add members.</p>
              )}
            </div>

            {/* Members List */}
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Members</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {room.participants?.map(participant => {
                  const user = typeof participant === 'object' ? participant : { _id: participant, username: 'Unknown' };
                  const isCurrentUser = user._id === currentUserId;
                  const isGroupAdmin = room.admins?.some(admin => (admin._id || admin) === user._id);

                  return (
                    <div key={user._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center text-sm font-semibold">
                          {user.username?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">
                            {user.username}
                            {isCurrentUser && ' (You)'}
                            {isGroupAdmin && ' (Admin)'}
                          </div>
                        </div>
                      </div>

                      {/* Remove button for admins or self */}
                      {(isAdmin || isCurrentUser) && (
                        <button
                          onClick={() => handleRemoveMember(user._id)}
                          disabled={isLoading}
                          className="text-red-600 hover:text-red-800 disabled:text-gray-400"
                          title={isCurrentUser ? 'Leave group' : 'Remove member'}
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupManagementModal;