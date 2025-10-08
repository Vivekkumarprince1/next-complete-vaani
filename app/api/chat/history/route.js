import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Chat from '@/lib/models/Chat';
import User from '@/lib/models/User';
import { authenticate } from '@/lib/auth';

export async function GET(request) {
  try {
    await connectDB();

    const decoded = authenticate(request);
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const roomId = searchParams.get('roomId');
    // Pagination params
    const limit = parseInt(searchParams.get('limit') || '30', 10);
    const before = searchParams.get('before'); // ISO timestamp or number

    let query = {};

    if (roomId) {
      query = { room: roomId };
    } else if (userId) {
      query = {
        $or: [
          { sender: decoded.userId, receiver: userId },
          { sender: userId, receiver: decoded.userId }
        ],
        room: { $exists: false }
      };
    } else {
      return NextResponse.json({ error: 'Either userId or roomId is required' }, { status: 400 });
    }

    // Apply pagination: fetch messages older than `before` if provided.
    // We'll query for newest first then reverse to keep chronological order.
    const queryCursor = { ...query };
    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        queryCursor.timestamp = { $lt: beforeDate };
      }
    }

    const found = await Chat.find(queryCursor)
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('sender', 'username preferredLanguage')
      .populate('receiver', 'username preferredLanguage');

    // Reverse to chronological order (oldest -> newest)
    const messages = found.reverse();

    return NextResponse.json({ messages, hasMore: found.length === limit });
  } catch (err) {
    console.error('Error getting chat history:', err);
    if (err.message.includes('authorization')) {
      return NextResponse.json({ msg: err.message }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to get chat history' }, { status: 500 });
  }
}