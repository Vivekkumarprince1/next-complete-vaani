const sdk = require('microsoft-cognitiveservices-speech-sdk');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Azure Speech Service configuration
const SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
const SPEECH_REGION = process.env.AZURE_SPEECH_REGION;
const SPEECH_ENDPOINT = process.env.AZURE_SPEECH_ENDPOINT || `https://${SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issuetoken`;

console.log('Azure Speech Service Configuration (Text-to-Speech) [next]:');
console.log('Region:', SPEECH_REGION);
console.log('Endpoint:', SPEECH_ENDPOINT);
console.log('Key:', SPEECH_KEY ? '****' + SPEECH_KEY.slice(-4) : 'Not configured');

const voiceMap = {
  'en': 'en-US-JennyNeural',
  'hi': 'hi-IN-SwaraNeural',
  'es': 'es-ES-ElviraNeural',
  'fr': 'fr-FR-DeniseNeural',
  'de': 'de-DE-KatjaNeural',
  'it': 'it-IT-ElsaNeural',
  'ja': 'ja-JP-NanamiNeural',
  'ko': 'ko-KR-SunHiNeural',
  'pt': 'pt-BR-FranciscaNeural',
  'ru': 'ru-RU-SvetlanaNeural',
  'zh': 'zh-CN-XiaoxiaoNeural',
  'ar': 'ar-SA-ZariyahNeural',
  'ta': 'ta-IN-PallaviNeural',
  'te': 'te-IN-ShrutiNeural',
  'bn': 'bn-IN-TanishaaNeural',
  'gu': 'gu-IN-DhwaniNeural',
  'kn': 'kn-IN-SapnaNeural',
  'ml': 'ml-IN-SobhanaNeural',
  'mr': 'mr-IN-AarohiNeural',
  'pa': 'pa-IN-VaaniNeural',
  'ur': 'ur-IN-GulNeural'
};

const getVoiceFromLanguage = (languageCode) => {
  if (!languageCode) return null;
  const code = languageCode.toLowerCase().split('-')[0];
  return voiceMap[code] || null;
};

const testAzureSpeechConnection = async () => {
  try {
    if (!SPEECH_KEY || !SPEECH_REGION) {
      console.error('Azure Speech Service credentials not configured for connection test');
      return false;
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
    speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    const result = await new Promise((resolve, reject) => {
      synthesizer.speakTextAsync('Test',
        result => {
          synthesizer.close();
          resolve(result);
        },
        error => {
          synthesizer.close();
          reject(error);
        }
      );
    });

    return result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted;
  } catch (error) {
    console.error('Azure Speech Service connection test failed:', error);
    return false;
  }
};

const textToSpeech = async (text, targetLanguage, maxRetries = 3) => {
  if (!text || typeof text !== 'string') {
    throw new Error('Invalid or empty text input');
  }

  text = text.trim();
  if (text.length === 0) throw new Error('Empty text input');
  if (text.length < 3 && !text.endsWith('.')) text = text + '.';

  let attempts = 0;
  let lastError = null;

  if (attempts === 0) {
    try {
      const ok = await testAzureSpeechConnection();
      if (!ok) console.warn('Azure Speech Service connection test failed before synthesis');
    } catch (e) {
      console.error('Error testing Azure connection:', e);
    }
  }

  while (attempts < maxRetries) {
    try {
      if (!SPEECH_KEY || !SPEECH_REGION) {
        throw new Error('Azure Speech Service credentials not configured');
      }

      const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
      speechConfig.setServiceProperty('endpoint', SPEECH_ENDPOINT, sdk.ServicePropertyChannel.UriQueryParameter);

      const standardizedLanguage = targetLanguage || 'en-US';
      const voiceName = getVoiceFromLanguage(standardizedLanguage);
      if (!voiceName) {
        console.warn(`No voice found for language: ${standardizedLanguage}, falling back to English`);
        speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
      } else {
        speechConfig.speechSynthesisVoiceName = voiceName;
      }
      console.log(`🔍 TTS: Using voice: ${speechConfig.speechSynthesisVoiceName}`);

      speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz128KBitRateMonoMp3;

      const tempDir = os.tmpdir();
      const tempFileName = path.join(tempDir, `tts_temp_${Date.now()}.mp3`);
      const audioConfig = sdk.AudioConfig.fromAudioFileOutput(tempFileName);
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

      return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          synthesizer.close();
          reject(new Error('Text-to-speech operation timed out'));
        }, 30000);

  const ssmlLangCode = standardizedLanguage.includes('-') ? standardizedLanguage : (voiceName ? voiceName.split('-').slice(0,2).join('-') : standardizedLanguage + '-' + standardizedLanguage.toUpperCase());

        const ssml = `
          <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${ssmlLangCode}">
            <voice name="${speechConfig.speechSynthesisVoiceName}">
              ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </voice>
          </speak>
        `;

        synthesizer.speakSsmlAsync(
          ssml,
          result => {
            console.log(`🔍 TTS: Synthesizer result callback called, result:`, result);
            clearTimeout(timeoutId);
            synthesizer.close();
            try {
              // If file exists but is empty, retry a few times with short backoff
              const MAX_RETRIES = 5;
              const RETRY_DELAY_MS = 200;

              const finishWithError = (err) => {
                try { if (fs.existsSync(tempFileName)) fs.unlinkSync(tempFileName); } catch(e){}
                reject(err);
              };

              const checkFile = (attempt) => {
                try {
                  if (fs.existsSync(tempFileName)) {
                    const stats = fs.statSync(tempFileName);
                    console.log(`🔍 TTS: File exists, size: ${stats.size} bytes (attempt ${attempt})`);
                    if (stats.size > 0) {
                      const audioData = fs.readFileSync(tempFileName);
                      try { fs.unlinkSync(tempFileName); } catch(e){}
                      console.log(`🔍 TTS: Read ${audioData.length} bytes from file`);
                      console.log(`🔍 TTS: First 20 bytes: ${audioData.slice(0, 20).toString('hex')}`);
                      if (audioData && audioData.length > 0) {
                        resolve(audioData);
                        return;
                      }
                    }
                  }
                } catch (fileError) {
                  // ignore and retry
                }

                if (attempt < MAX_RETRIES) {
                  setTimeout(() => checkFile(attempt + 1), RETRY_DELAY_MS);
                } else {
                  finishWithError(new Error('Generated audio file is empty (0 bytes) after retries'));
                }
              };

              checkFile(1);
            } catch (fileError) {
              reject(fileError);
            }
          },
          error => {
            clearTimeout(timeoutId);
            synthesizer.close();
            try { if (fs.existsSync(tempFileName)) fs.unlinkSync(tempFileName); } catch(e){}
            reject(error);
          }
        );
      });

    } catch (error) {
      lastError = error;
      attempts++;
      if (attempts < maxRetries) {
        const backoff = Math.min(1000 * Math.pow(2, attempts), 8000);
        await new Promise(r => setTimeout(r, backoff));
      } else {
        throw lastError || new Error('Text-to-speech failed after multiple attempts');
      }
    }
  }
};

module.exports = {
  textToSpeech,
  testAzureSpeechConnection
};
