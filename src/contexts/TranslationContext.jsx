'use client'

import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { getCachedTranslation, setCachedTranslation, clearTranslationCache, prefetchModel } from '../hooks/useTranslationCache';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

// Create the context
export const TranslationContext = createContext();

// Translation cache to store previously translated text
const translationCache = new Map();

// Available languages
const AVAILABLE_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
];

// UI translations for common text
const UI_TRANSLATIONS = {
  en: {
    welcome: 'Welcome',
    chat: 'Chat',
    send: 'Send',
    typeMessage: 'Type a message...',
    online: 'Online',
    offline: 'Offline',
    contacts: 'Contacts',
    groups: 'Groups',
    groupChat: 'Group Chat',
    logout: 'Logout',
    loading: 'Loading...',
    answer: 'Answer',
    decline: 'Decline',
    mute: 'Mute',
    unmute: 'Unmute',
    camera: 'Camera On',
    cameraOff: 'Camera Off',
    endCall: 'End Call',
    incomingCall: 'Incoming Call',
    toggleSidebar: 'Toggle Sidebar',
  },
  // Add more languages as needed
};

export const TranslationProvider = ({ children }) => {
  const [currentLanguage, setCurrentLanguage] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('preferredLanguage') || 'en';
    }
    return 'en';
  });
  
  const [languages, setLanguages] = useState({});

  // Load saved language preference on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedLanguage = localStorage.getItem('preferredLanguage');
      if (savedLanguage) {
        setCurrentLanguage(savedLanguage);
      }
    }
  }, []);
  
  // Fetch available languages from Azure Translator API
  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        if (typeof window === 'undefined') return;
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const response = await axios.get(`${API_URL}/translator/languages`, {
          headers: { 'x-auth-token': token }
        });
        setLanguages(response.data);
      } catch (error) {
        console.error('Failed to fetch languages:', error);
      }
    };
    
    fetchLanguages();
  }, []);

  // Save language preference when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferredLanguage', currentLanguage);
    }
  }, [currentLanguage]);

  // Prefetch a lightweight language artifact (if backend exposes it) to speed up local work
  useEffect(() => {
    const doPrefetch = async () => {
      if (typeof window === 'undefined') return;
      try {
        const modelUrl = `${API_URL}/translator/model-metadata/${currentLanguage}`;
        await prefetchModel(modelUrl, `model-metadata-${currentLanguage}`);
      } catch (err) {
        // non-fatal
      }
    };
    doPrefetch();
  }, [currentLanguage]);

  // Function to change the current language
  const changeLanguage = async (language) => {
    try {
      // Get the auth token
      if (typeof window === 'undefined') return false;
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No auth token found');
        return false;
      }

      // Update language preference in the backend
      await axios.put(
        `${API_URL}/auth/language`,
        { language },
        {
          headers: {
            'x-auth-token': token
          }
        }
      );

      // Update local state and storage
      setCurrentLanguage(language);
      localStorage.setItem('preferredLanguage', language);

      // Clear translation cache when language changes
      translationCache.clear();
      try {
        await clearTranslationCache();
      } catch (err) {
        // ignore persistent cache clear failures
      }

      // Notify socket server about language change
      try {
        const socketManager = (await import('../utils/socketManager')).default;
        if (socketManager.socket?.connected) {
          socketManager.emit('updateLanguagePreference', { language });
          console.log('📡 Sent language preference update to server:', language);
        }
      } catch (socketError) {
        console.warn('Could not notify socket server of language change:', socketError);
      }

      return true;
    } catch (error) {
      console.error('Error changing language:', error);
      return false;
    }
  };

  // Function to translate text
  const translateText = async (text, targetLang = currentLanguage, sourceLang = null) => {
    if (!text) return '';
    
    // Don't translate if source and target are the same
    if (sourceLang && sourceLang === targetLang) {
      return text;
    }

    // Check cache first (in-memory + persisted)
    const cacheKey = `${text}:${sourceLang || 'auto'}:${targetLang}`;
    if (translationCache.has(cacheKey)) {
      return translationCache.get(cacheKey);
    }

    try {
      const persisted = await getCachedTranslation(cacheKey);
      if (persisted) {
        translationCache.set(cacheKey, persisted);
        return persisted;
      }
    } catch (err) {
      // ignore DB errors
    }

    try {
      if (typeof window === 'undefined') return text;
      const token = localStorage.getItem('token');
      if (!token) return text;

      const response = await axios.post(
        `${API_URL}/chat/translate`, 
        {
          text,
          targetLang,
          sourceLang
        },
        {
          headers: {
            'x-auth-token': token
          }
        }
      );

      const translation = response.data.translation;

      // Cache in-memory and persist
      translationCache.set(cacheKey, translation);
      try {
        await setCachedTranslation(cacheKey, translation);
      } catch (err) {
        // ignore persistence errors
      }

      return translation;
    } catch (error) {
      console.error('Translation error:', error);
      return text; // Return original text if translation fails
    }
  };

  // Function to translate multiple texts in batch
  const translateTexts = async (texts, targetLang = currentLanguage, sourceLang = null) => {
    if (!texts || !Array.isArray(texts) || texts.length === 0) return [];
    
    // Don't translate if source and target are the same
    if (sourceLang && sourceLang === targetLang) {
      return texts;
    }

    // Filter out empty texts
    const validTexts = texts.filter(text => text && text.trim());
    if (validTexts.length === 0) return texts;

    // Check cache for all texts
    const uncachedTexts = [];
    const uncachedIndices = [];
    const cachedResults = texts.map((text, index) => {
      if (!text || !text.trim()) return text;
      
      const cacheKey = `${text}:${sourceLang || 'auto'}:${targetLang}`;
      if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey);
      } else {
        uncachedTexts.push(text);
        uncachedIndices.push(index);
        return null; // Will be filled later
      }
    });

    // If all texts are cached, return immediately
    if (uncachedTexts.length === 0) {
      return cachedResults;
    }

    try {
      if (typeof window === 'undefined') return texts;
      const token = localStorage.getItem('token');
      if (!token) return texts;

      console.log(`🔄 Batch translating ${uncachedTexts.length} texts to ${targetLang}`);

      const response = await axios.post(
        `${API_URL}/chat/translate`, 
        {
          texts: uncachedTexts,
          targetLang,
          sourceLang
        },
        {
          headers: {
            'x-auth-token': token
          }
        }
      );

      const translations = response.data.translations;

      // Cache and fill results
      uncachedIndices.forEach((originalIndex, batchIndex) => {
        const originalText = uncachedTexts[batchIndex];
        const translation = translations[batchIndex];
        
        // Cache the translation
        const cacheKey = `${originalText}:${sourceLang || 'auto'}:${targetLang}`;
        translationCache.set(cacheKey, translation);
        
        // Fill the result
        cachedResults[originalIndex] = translation;
      });

      console.log(`✅ Batch translation completed: ${uncachedTexts.length} texts translated`);

      return cachedResults;
    } catch (error) {
      console.error('Batch translation error:', error);
      // Return original texts for failed translations
      return texts;
    }
  };

  // Function to get UI translations
  const t = (key) => {
    const translations = UI_TRANSLATIONS[currentLanguage] || UI_TRANSLATIONS.en;
    return translations[key] || UI_TRANSLATIONS.en[key] || key;
  };

  const value = {
    currentLanguage,
    changeLanguage,
    translateText,
    translateTexts,
    t,
    availableLanguages: AVAILABLE_LANGUAGES,
    languages  // Full language data from Azure
  };

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
};

// Custom hook to use the translation context
export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error('useTranslation must be used within a TranslationProvider');
  }
  return context;
};