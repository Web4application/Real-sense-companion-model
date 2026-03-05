/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session, Type} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

interface Task {
  id: string;
  title: string;
  status: 'pending' | 'completed' | 'abandoned';
  priority: number;
  createdAt: number;
  dueDate?: string;
  isReminder?: boolean;
}

interface UserProfile {
  name: string;
  interests: string[];
  tone: string;
  habits: string[];
  lastCheckIn: number;
  stats: {
    streak: number;
    dailyGoal: number;
    completedToday: number;
    lastCompletedDate?: string;
  };
}

interface MemoryEntry {
  timestamp: number;
  userIntent: string;
  userInput: string;
  style: string;
  links: {url: string, text: string}[];
  message: string;
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() private hasCamera = false;
  @state() private memory: MemoryEntry[] = [];
  @state() private tasks: Task[] = [];
  @state() private isPlayingMedia = false;
  @state() private currentMedia: string | null = null;
  @state() private profile: UserProfile = {
    name: 'Seriki',
    interests: [],
    tone: 'friendly',
    habits: [],
    lastCheckIn: 0,
    stats: {
      streak: 0,
      dailyGoal: 5,
      completedToday: 0
    }
  };

  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new (window.AudioContext ||
    window.webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    window.webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private videoElement: HTMLVideoElement | null = null;
  private canvasElement: HTMLCanvasElement | null = null;
  private frameInterval: number | null = null;
  private mediaTimer: number | null = null;
  private audioPlayer: HTMLAudioElement | null = null;

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: row;
      gap: 20px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .camera-preview {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 200px;
        height: 150px;
        border-radius: 12px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        overflow: hidden;
        background: black;
        z-index: 20;
        display: block;
      }

      video {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .links-container {
        position: absolute;
        top: 20px;
        left: 20px;
        z-index: 10;
        background: rgba(0, 0, 0, 0.5);
        padding: 15px;
        border-radius: 12px;
        color: white;
        max-width: 250px;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        font-family: sans-serif;
      }

      .links-container h3 {
        margin: 0 0 10px 0;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 1px;
        opacity: 0.7;
      }

      .links-container ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .links-container a {
        color: #4fc3f7;
        text-decoration: none;
        font-size: 13px;
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .links-container a:hover {
        text-decoration: underline;
      }

      .memory-indicator {
        position: absolute;
        bottom: 20px;
        right: 20px;
        z-index: 10;
        background: rgba(255, 255, 255, 0.1);
        padding: 8px 12px;
        border-radius: 20px;
        color: white;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .lmlm-panel {
        position: absolute;
        top: 20px;
        left: 20px;
        bottom: 20px;
        width: 300px;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: 15px;
        pointer-events: none;
      }

      .lmlm-card {
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(15px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 15px;
        color: white;
        pointer-events: auto;
      }

      .lmlm-card h3 {
        margin: 0 0 10px 0;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        opacity: 0.5;
      }

      .task-item {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
        font-size: 13px;
      }

      .task-status {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }

      .status-pending { background: #ffd54f; }
      .status-completed { background: #81c784; }
      .status-abandoned { background: #e57373; }

      .now-playing {
        background: linear-gradient(135deg, #1a237e 0%, #121212 100%);
        border: 1px solid rgba(79, 195, 247, 0.3);
        box-shadow: 0 0 20px rgba(79, 195, 247, 0.2);
      }

      .now-playing .media-info {
        display: flex;
        align-items: center;
        gap: 15px;
      }

      .music-icon {
        width: 40px;
        height: 40px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0% { transform: scale(1); opacity: 0.8; }
        50% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(1); opacity: 0.8; }
      }

      .profile-info {
        font-size: 13px;
        line-height: 1.4;
      }

      .profile-info strong {
        color: #4fc3f7;
      }

      .streak-card {
        background: linear-gradient(135deg, #43a047 0%, #1b5e20 100%);
        border: 1px solid rgba(129, 199, 132, 0.3);
      }

      .progress-bar-container {
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        margin: 10px 0;
        overflow: hidden;
      }

      .progress-bar-fill {
        height: 100%;
        background: #81c784;
        transition: width 0.5s ease-out;
      }

      .streak-count {
        font-size: 24px;
        font-weight: bold;
        display: flex;
        align-items: baseline;
        gap: 5px;
      }

      .streak-count span {
        font-size: 12px;
        opacity: 0.7;
        font-weight: normal;
      }
    }
  `;

  constructor() {
    super();
    this.loadData();
    this.initClient();
  }

  private loadData() {
    const storedMemory = localStorage.getItem('ai_DLL');
    if (storedMemory) {
      try { this.memory = JSON.parse(storedMemory); } catch (e) {}
    }

    const storedTasks = localStorage.getItem('lmlm_tasks');
    if (storedTasks) {
      try { this.tasks = JSON.parse(storedTasks); } catch (e) {}
    }

    const storedProfile = localStorage.getItem('lmlm_profile');
    if (storedProfile) {
      try { this.profile = JSON.parse(storedProfile); } catch (e) {}
    }
  }

  private saveTasks() {
    localStorage.setItem('lmlm_tasks', JSON.stringify(this.tasks));
  }

  private saveProfile() {
    localStorage.setItem('lmlm_profile', JSON.stringify(this.profile));
  }

  private saveMemory(entry: Omit<MemoryEntry, 'timestamp'>) {
    const newEntry: MemoryEntry = {
      ...entry,
      timestamp: Date.now(),
    };
    this.memory = [...this.memory, newEntry];
    localStorage.setItem('ai_DLL', JSON.stringify(this.memory));
    return {status: 'success', entry: newEntry};
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.audioPlayer = new Audio();
    this.audioPlayer.loop = true;

    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle tool calls
            const toolCalls = message.serverContent?.modelTurn?.parts.find(p => p.toolCall)?.toolCall;
            if (toolCalls) {
              const responses = [];
              for (const call of toolCalls.functionCalls) {
                if (call.name === 'get_links') {
                  const links = Array.from(this.shadowRoot?.querySelectorAll('a') || [])
                    .concat(Array.from(document.querySelectorAll('a')))
                    .map(a => ({
                      url: (a as HTMLAnchorElement).href,
                      text: (a as HTMLElement).innerText.trim()
                    }));
                  responses.push({
                    name: call.name,
                    id: call.id,
                    response: {links}
                  });
                } else if (call.name === 'save_to_memory') {
                  const result = this.saveMemory(call.args as any);
                  responses.push({
                    name: call.name,
                    id: call.id,
                    response: result
                  });
                } else if (call.name === 'get_memory') {
                  responses.push({
                    name: call.name,
                    id: call.id,
                    response: {memory: this.memory}
                  });
                } else if (call.name === 'manage_tasks') {
                  const {action, task} = call.args as any;
                  if (action === 'add') {
                    const newTask: Task = {
                      ...task, 
                      id: Math.random().toString(36).substr(2, 9), 
                      createdAt: Date.now(), 
                      status: 'pending'
                    };
                    this.tasks = [...this.tasks, newTask];
                  } else if (action === 'update') {
                    const oldTask = this.tasks.find(t => t.id === task.id);
                    if (oldTask && oldTask.status !== 'completed' && task.status === 'completed') {
                      this.handleTaskCompletion();
                    }
                    this.tasks = this.tasks.map(t => t.id === task.id ? {...t, ...task} : t);
                  } else if (action === 'delete') {
                    this.tasks = this.tasks.filter(t => t.id !== task.id);
                  }
                  this.saveTasks();
                  responses.push({
                    name: call.name,
                    id: call.id,
                    response: {status: 'success', tasks: this.tasks}
                  });
                } else if (call.name === 'update_profile') {
                  this.profile = {...this.profile, ...call.args as any};
                  this.saveProfile();
                  responses.push({
                    name: call.name,
                    id: call.id,
                    response: {status: 'success', profile: this.profile}
                  });
                } else if (call.name === 'play_media') {
                  const {query} = call.args as any;
                  this.playMedia(query);
                  responses.push({
                    name: call.name,
                    id: call.id,
                    response: {status: 'playing', media: query}
                  });
                }
              }
              this.session.sendToolResponse({functionResponses: responses});
            }

            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Close:' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Puck'}},
          },
          tools: [
            { googleSearch: {} },
            {
              functionDeclarations: [
                {
                  name: 'get_links',
                  description: 'Extracts all links from the current page.',
                  parameters: {type: Type.OBJECT, properties: {}}
                },
                {
                  name: 'manage_tasks',
                  description: 'Adds, updates, or deletes tasks for the user. Supports complex, multi-part instructions by allowing multiple calls or detailed task objects.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {type: Type.STRING, enum: ['add', 'update', 'delete', 'list']},
                      task: {
                        type: Type.OBJECT,
                        properties: {
                          id: {type: Type.STRING},
                          title: {type: Type.STRING},
                          status: {type: Type.STRING, enum: ['pending', 'completed', 'abandoned']},
                          priority: {type: Type.NUMBER},
                          dueDate: {type: Type.STRING, description: 'ISO date string or relative time like "tomorrow"'},
                          isReminder: {type: Type.BOOLEAN}
                        }
                      }
                    },
                    required: ['action']
                  }
                },
                {
                  name: 'update_profile',
                  description: 'Updates the user profile with new information (name, interests, etc).',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      name: {type: Type.STRING},
                      interests: {type: Type.ARRAY, items: {type: Type.STRING}},
                      tone: {type: Type.STRING},
                      habits: {type: Type.ARRAY, items: {type: Type.STRING}}
                    }
                  }
                },
                {
                  name: 'play_media',
                  description: 'Plays music, ambient sounds, or podcasts for the user.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: {type: Type.STRING, description: 'The name of the song or type of audio to play.'}
                    },
                    required: ['query']
                  }
                },
                {
                  name: 'save_to_memory',
                  description: 'Saves a summary of the current interaction to long-term memory.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      userIntent: {type: Type.STRING},
                      userInput: {type: Type.STRING},
                      style: {type: Type.STRING},
                      links: {type: Type.ARRAY, items: {type: Type.OBJECT, properties: {url: {type: Type.STRING}, text: {type: Type.STRING}}}},
                      message: {type: Type.STRING}
                    },
                    required: ['userIntent', 'userInput', 'style', 'links', 'message']
                  }
                }
              ]
            }
          ],
          systemInstruction: `You are LMLM (Listen, Learn, Move), a personal AI companion for Seriki.
Your mission is to track tasks, provide daily guidance, and learn from conversations.

CORE BEHAVIORS:
1. VOICE-FIRST: Respond concisely and naturally. Use your voice as the primary output.
2. COMPLEX COMMANDS: You can handle multi-part instructions. If a user says "Add milk to my list and remind me tomorrow", call 'manage_tasks' twice or with appropriate metadata.
3. HABIT LOOP:
   - Morning: Greet Seriki, provide a priority overview of top 3 tasks. Mention the current streak.
   - Midday: Nudge about stuck or abandoned tasks.
   - Evening: Reflect on the day's highlights and stress points.
   - Night: Summarize the day and prep for tomorrow.
4. LEARNING: Use 'update_profile' and 'save_to_memory' to grow with Seriki.
5. AWARENESS: Use 'googleSearch' for trending news, crypto, and emergency updates.
6. VISION: Comment on what you see in the camera feed if relevant.

Current time: ${new Date().toLocaleString()}. Use this to determine the current phase of the habit loop.
Be friendly, motivational, and proactive. If Seriki is idle, you can initiate a check-in.`,
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private handleTaskCompletion() {
    const today = new Date().toISOString().split('T')[0];
    const stats = { ...this.profile.stats };

    if (stats.lastCompletedDate !== today) {
      // First task of the day
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (stats.lastCompletedDate === yesterdayStr) {
        stats.streak += 1;
      } else if (!stats.lastCompletedDate) {
        stats.streak = 1;
      } else {
        stats.streak = 1; // Streak broken
      }
      stats.completedToday = 1;
      stats.lastCompletedDate = today;
    } else {
      stats.completedToday += 1;
    }

    this.profile = { ...this.profile, stats };
    this.saveProfile();
  }

  private playMedia(query: string) {
    this.isPlayingMedia = true;
    this.currentMedia = query;
    
    // In a real app, we'd search and play a real URL. 
    // For this companion, we'll use a high-quality ambient track as a placeholder.
    if (this.audioPlayer) {
      this.audioPlayer.src = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
      this.audioPlayer.play().catch(e => console.error('Playback failed', e));
    }

    // Auto-pause logic: 10 minutes (600,000 ms)
    if (this.mediaTimer) window.clearTimeout(this.mediaTimer);
    this.mediaTimer = window.setTimeout(() => {
      this.handleAutoPause();
    }, 600000); 
  }

  private handleAutoPause() {
    if (!this.isPlayingMedia) return;
    
    this.isPlayingMedia = false;
    if (this.audioPlayer) {
      this.audioPlayer.pause();
    }

    // LMLM initiates a "human-like" check-in
    if (this.session) {
      this.session.sendRealtimeInput({
        text: "I've paused the music for a moment. Seriki, what was that you were listening to? It sounded interesting!"
      });
    }
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();
    this.outputAudioContext.resume();

    this.updateStatus('Requesting microphone and camera access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: {ideal: 640},
          height: {ideal: 480},
        },
      });

      this.updateStatus('Access granted. Starting capture...');

      // Setup video preview
      this.videoElement = this.shadowRoot?.querySelector('video') || null;
      if (this.videoElement) {
        this.videoElement.srcObject = this.mediaStream;
      }

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 2048;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.session) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      // Setup frame capture
      this.canvasElement = document.createElement('canvas');
      this.frameInterval = window.setInterval(() => {
        this.captureFrame();
      }, 1000); // 1 frame per second

      this.isRecording = true;
      this.hasCamera = true;
      this.updateStatus('🔴 Recording... Capturing audio and video.');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private captureFrame() {
    if (!this.isRecording || !this.session || !this.videoElement || !this.canvasElement) return;

    const canvas = this.canvasElement;
    const video = this.videoElement;
    const context = canvas.getContext('2d');

    if (context && video.videoWidth > 0) {
      canvas.width = 320; // Lower resolution for faster transmission
      canvas.height = (video.videoHeight / video.videoWidth) * canvas.width;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const base64Data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
      this.session.sendRealtimeInput({
        media: {
          data: base64Data,
          mimeType: 'image/jpeg',
        },
      });
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;
    this.hasCamera = false;

    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }

    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode = null;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  render() {
    return html`
      <div>
        <div class="lmlm-panel">
          ${this.isPlayingMedia ? html`
            <div class="lmlm-card now-playing">
              <h3>Now Playing</h3>
              <div class="media-info">
                <div class="music-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#4fc3f7">
                    <path d="M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560v400q0 66-47 113t-113 47Z"/>
                  </svg>
                </div>
                <div>
                  <div style="font-size: 14px; font-weight: bold;">${this.currentMedia}</div>
                  <div style="font-size: 11px; opacity: 0.6;">LMLM Audio Stream</div>
                </div>
              </div>
            </div>
          ` : ''}

          <div class="lmlm-card">
            <h3>Companion: LMLM</h3>
            <div class="profile-info">
              Hello, <strong>${this.profile.name}</strong>.<br/>
              Tone: ${this.profile.tone}<br/>
              Interests: ${this.profile.interests.join(', ') || 'Learning...'}
            </div>
          </div>

          <div class="lmlm-card streak-card">
            <h3>Habits & Streaks</h3>
            <div class="streak-count">
              ${this.profile.stats.streak} <span>day streak</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width: ${Math.min(100, (this.profile.stats.completedToday / this.profile.stats.dailyGoal) * 100)}%"></div>
            </div>
            <div style="font-size: 11px; opacity: 0.8;">
              Daily Goal: ${this.profile.stats.completedToday} / ${this.profile.stats.dailyGoal} tasks
            </div>
          </div>

          <div class="lmlm-card">
            <h3>Active Tasks</h3>
            ${this.tasks.filter(t => t.status === 'pending').map(t => html`
              <div class="task-item">
                <div class="task-status status-pending"></div>
                <span>${t.title}</span>
              </div>
            `)}
            ${this.tasks.filter(t => t.status === 'pending').length === 0 ? html`<div style="opacity: 0.5; font-size: 12px;">No active tasks.</div>` : ''}
          </div>

          <div class="lmlm-card">
            <h3>Daily Habit Loop</h3>
            <div style="font-size: 11px; opacity: 0.7;">
              ${new Date().getHours() < 12 ? '🌅 Morning Check-in' : 
                new Date().getHours() < 17 ? '☀️ Midday Support' : 
                new Date().getHours() < 21 ? '🌆 Evening Reflection' : '🌙 Night Closure'}
            </div>
          </div>
        </div>

        ${this.memory.length > 0 ? html`
          <div class="memory-indicator">
            Memory: ${this.memory.length} entries
          </div>
        ` : ''}

        ${this.hasCamera ? html`
          <div class="camera-preview">
            <video autoplay playsinline muted></video>
          </div>
        ` : ''}
        <div class="controls">
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#c80000"
              xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="50" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#000000"
              xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="100" height="100" rx="15" />
            </svg>
          </button>
        </div>

        <div id="status"> ${this.error} </div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
