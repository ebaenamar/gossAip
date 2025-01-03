'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

interface Story {
  content: string;
  isReal: boolean;
  redditUrl?: string;
}

interface GossipResponse {
  topic: string;
  stories: Story[];
  correctIndex: number;
}

export default function GossipGame() {
  const searchParams = useSearchParams();
  const [topic, setTopic] = useState(searchParams.get('topic') || '');
  const [loading, setLoading] = useState(false);
  const [stories, setStories] = useState<Story[]>([]);
  const [correctIndex, setCorrectIndex] = useState<number>(-1);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [revealed, setRevealed] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60); // 1 minute in seconds
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameStarted && !gameOver && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setGameOver(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameStarted, gameOver, timeLeft]);

  const fetchGossip = async (searchTopic: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/reddit?topic=${encodeURIComponent(searchTopic)}`);
      if (!response.ok) {
        const data = await response.json();
        if (data.suggestion) {
          setTopic(data.suggestion);
        }
        throw new Error(data.error || 'Failed to fetch gossip');
      }
      const data: GossipResponse = await response.json();
      setStories(data.stories);
      setCorrectIndex(data.correctIndex);
      setSelectedIndex(-1);
      setRevealed(false);
    } catch (error) {
      console.error('Error fetching gossip:', error);
      alert(error instanceof Error ? error.message : 'Failed to fetch gossip');
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = () => {
    setGameStarted(true);
    setScore(0);
    setAttempts(0);
    setTimeLeft(60);
    setGameOver(false);
    if (topic) {
      fetchGossip(topic);
    }
  };

  const handleNextGossip = () => {
    if (topic) {
      fetchGossip(topic);
    }
  };

  const handleGuess = (index: number) => {
    if (selectedIndex === -1 && !revealed) {
      setSelectedIndex(index);
      setRevealed(true);
      setAttempts(prev => prev + 1);
      if (index === correctIndex) {
        setScore(prev => prev + 1);
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getScoreMessage = (score: number) => {
    if (score >= 5) {
      return "🎭 👑 You are the ULTIMATE GOSSIP MASTER! 👑 🎭\nYour ability to spot real tea is legendary! 🫖✨";
    } else if (score >= 3) {
      return "🌟 Impressive Gossip Detective! 🔍\nYou've got a natural talent for spotting the truth! 💫";
    } else if (score >= 1) {
      return "🎯 Not Bad, Gossip Apprentice! 📚\nKeep practicing your rumor radar! 🎪";
    } else {
      return "🎪 Welcome to the Gossip Circus! 🎪\nTime to sharpen those truth-spotting skills! 🎭";
    }
  };

  const getTimeMessage = (timeLeft: number) => {
    if (timeLeft <= 10) {
      return "⏰ Hurry up! Time's almost up! ⚡";
    } else if (timeLeft <= 30) {
      return "⌛ Clock is ticking... Choose wisely! 🤔";
    }
    return "🕒 Take your time to spot the truth! 🔍";
  };

  if (gameOver) {
    const message = getScoreMessage(score);
    const accuracy = attempts > 0 ? Math.round((score / attempts) * 100) : 0;
    
    return (
      <div className="max-w-4xl mx-auto p-8 bg-gradient-to-br from-purple-900/80 to-pink-900/80 backdrop-blur-lg rounded-2xl shadow-2xl border-2 border-purple-400/30">
        <div className="text-center text-white space-y-8">
          <h2 className="text-5xl font-bold mb-8 bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 text-transparent bg-clip-text animate-gradient">Game Over!</h2>
          
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="bg-white/10 p-6 rounded-xl backdrop-blur-md transform hover:scale-105 transition-all">
              <div className="text-4xl font-bold text-purple-300 mb-2">{score}</div>
              <div className="text-purple-200">Correct Guesses</div>
            </div>
            <div className="bg-white/10 p-6 rounded-xl backdrop-blur-md transform hover:scale-105 transition-all">
              <div className="text-4xl font-bold text-pink-300 mb-2">{attempts}</div>
              <div className="text-pink-200">Total Attempts</div>
            </div>
            <div className="bg-white/10 p-6 rounded-xl backdrop-blur-md transform hover:scale-105 transition-all">
              <div className="text-4xl font-bold text-purple-300 mb-2">{accuracy}%</div>
              <div className="text-purple-200">Accuracy</div>
            </div>
          </div>

          <div className="space-y-6">
            <p className="text-3xl font-medium whitespace-pre-line bg-gradient-to-r from-purple-200 to-pink-200 text-transparent bg-clip-text">{message}</p>
            <button
              onClick={handleStartGame}
              className="mt-8 px-12 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 hover:shadow-lg font-bold text-xl shadow-xl"
            >
              Play Again 🎭
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!gameStarted) {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-white/10 backdrop-blur-lg rounded-xl shadow-xl">
        <h1 className="text-4xl font-bold text-center mb-6 bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 text-transparent bg-clip-text animate-gradient">Gossip Game</h1>
        <div className="space-y-4">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What's the tea about...?"
            className="w-full p-4 rounded-xl bg-white/20 text-white placeholder-white/50 backdrop-blur-sm border-2 border-white/10 focus:border-purple-400/50 outline-none transition-colors"
          />
          <button
            onClick={handleStartGame}
            disabled={!topic}
            className="w-full px-6 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 font-medium text-lg shadow-xl"
          >
            Start 1-Minute Tea Time! ☕️
          </button>
          <div className="text-center pt-4 space-y-2">
            <p className="text-white/80 text-lg">Enter any celebrity or trending topic</p>
            <p className="text-white/60">You'll get two stories - one real, one AI-made.<br/>Can you tell which is which? 🔍</p>
            <p className="text-white/60">You have 60 seconds to guess correctly. Good luck!</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white/10 backdrop-blur-lg rounded-lg shadow-xl">
      <div className="mb-6 flex justify-between items-center text-white">
        <div>Score: {score}</div>
        <div>{getTimeMessage(timeLeft)} ({formatTime(timeLeft)})</div>
      </div>
      
      {loading ? (
        <div className="text-center py-8 text-white">Loading gossip...</div>
      ) : stories.length === 0 ? (
        <div className="text-center py-8 space-y-4 animate-fade-in">
          <p className="text-white/90 text-xl font-medium">Time to test your gossip radar! 🔍</p>
          <p className="text-white/80 text-lg">One of these stories is real, the other is AI-generated.<br/>Can you spot which is which? You have 60 seconds!</p>
        </div>
      ) : (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold mb-4 text-white">Topic: {topic}</h2>
          
          <div className="space-y-4">
            {stories.map((story, index) => (
              <div
                key={index}
                onClick={() => handleGuess(index)}
                className={`p-6 rounded-xl backdrop-blur-md transition-all transform hover:scale-[1.02] cursor-pointer ${
                  revealed
                    ? index === correctIndex
                      ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-2 border-green-400/30'
                      : 'bg-gradient-to-r from-red-500/20 to-pink-500/20 border-2 border-red-400/30'
                    : selectedIndex === index
                    ? 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-2 border-purple-400/30'
                    : 'bg-white/10 hover:bg-white/20 border-2 border-white/10'
                }`}
              >
                <p className="text-white text-lg leading-relaxed">{story.content}</p>
                {revealed && index === correctIndex && story.redditUrl && (
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-green-300 font-medium">✨ This was the real gossip!</span>
                    <a
                      href={story.redditUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-300 hover:text-blue-400 flex items-center gap-2 transition-colors"
                    >
                      <span>View on Reddit</span>
                      <span className="text-xl">→</span>
                    </a>
                  </div>
                )}
                {revealed && !story.isReal && (
                  <div className="mt-4">
                    <span className="text-red-300 font-medium">🎭 This was the AI-generated story!</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {revealed && (
            <button
              onClick={handleNextGossip}
              className="w-full mt-4 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Next Gossip!
            </button>
          )}
        </div>
      )}
    </div>
  );
}
