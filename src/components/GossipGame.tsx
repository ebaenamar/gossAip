'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

interface Story {
  content: string;
  isReal: boolean;
  redditUrl?: string;
  engagementScore?: number;
  isPartialMatch?: boolean;
  mainSubject?: string;
  subreddit?: string;
  storyId: string;
}

interface GossipResponse {
  stories?: Story[];
  correctIndex?: number;
  originalTopic?: string;
  mainSubject?: string;
  isPartialMatch?: boolean;
  newStoryIds?: string[];
  error?: string;
  suggestion?: string;
  message?: string;
}

export default function GossipGame() {
  const searchParams = useSearchParams();
  const [topic, setTopic] = useState(searchParams.get('topic') || '');
  const [stories, setStories] = useState<Story[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [correctIndex, setCorrectIndex] = useState(-1);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30); // 30 seconds
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [recentStories, setRecentStories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    const stored = localStorage.getItem('recentStories');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const recent = parsed.filter((item: {id: string, timestamp: number}) => 
          item.timestamp > oneHourAgo
        );
        setRecentStories(recent.map((item: {id: string}) => item.id));
        localStorage.setItem('recentStories', JSON.stringify(recent));
      } catch (e) {
        console.error('Error parsing recent stories:', e);
        localStorage.removeItem('recentStories');
      }
    }
  }, []);

  const fetchGossip = async (searchTopic: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/reddit?topic=${encodeURIComponent(searchTopic)}&recentStories=${encodeURIComponent(JSON.stringify(recentStories))}`
      );
      const data: GossipResponse = await response.json();

      if (!response.ok) {
        if (data.suggestion) {
          setTopic(data.suggestion);
        }
        throw new Error(data.error || data.message || 'Failed to fetch gossip');
      }

      if (!data.stories || !data.correctIndex) {
        throw new Error('Invalid response from server');
      }

      setStories(data.stories);
      setCorrectIndex(data.correctIndex);

      if (data.newStoryIds && data.newStoryIds.length > 0) {
        const newRecent = [
          ...recentStories,
          ...data.newStoryIds.map((id: string) => ({
            id,
            timestamp: Date.now()
          }))
        ];
        setRecentStories(newRecent.map(item => item.id));
        localStorage.setItem('recentStories', JSON.stringify(newRecent));
      }

      setSelectedIndex(-1);
      setRevealed(false);
      setGameStarted(true);
    } catch (error) {
      console.error('Error fetching gossip:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch gossip');
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = () => {
    setGameStarted(true);
    setScore(0);
    setAttempts(0);
    setTimeLeft(30); // 30 seconds
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
    
    return (
      <div className="max-w-2xl mx-auto p-8 bg-white/10 backdrop-blur-lg rounded-lg shadow-xl border-2 border-purple-400/30">
        <div className="text-center text-white space-y-6">
          <h2 className="text-3xl font-bold mb-6 bg-gradient-to-r from-purple-400 to-pink-400 text-transparent bg-clip-text">Game Over!</h2>
          <div className="space-y-4 mb-8">
            <p className="text-2xl font-medium whitespace-pre-line">{message}</p>
            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mt-6">
              <div className="bg-purple-900/40 p-4 rounded-lg">
                <p className="text-lg">Score</p>
                <p className="text-3xl font-bold text-purple-300">{score}</p>
              </div>
              <div className="bg-purple-900/40 p-4 rounded-lg">
                <p className="text-lg">Attempts</p>
                <p className="text-3xl font-bold text-purple-300">{attempts}</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleStartGame}
            className="mt-8 px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all transform hover:scale-105 font-medium text-lg shadow-lg"
          >
            Play Again 🎭
          </button>
        </div>
      </div>
    );
  }

  if (!gameStarted) {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-white/10 backdrop-blur-lg rounded-lg shadow-xl">
        <h1 className="text-3xl font-bold text-center mb-6 text-white">Gossip Game</h1>
        <div className="space-y-4">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What's the tea about...?"
            className="w-full p-3 rounded-lg bg-white/20 text-white placeholder-white/50 backdrop-blur-sm"
          />
          <button
            onClick={handleStartGame}
            disabled={!topic}
            className="w-full px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Start 30-Second Tea Time! ☕️
          </button>
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
      ) : (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold mb-4 text-white">Topic: {topic}</h2>
          
          <div className="space-y-4">
            {stories.map((story, index) => (
              <div
                key={index}
                onClick={() => handleGuess(index)}
                className={`p-4 rounded-lg cursor-pointer transition-colors ${
                  revealed
                    ? index === correctIndex
                      ? 'bg-green-500/20'
                      : 'bg-red-500/20'
                    : selectedIndex === index
                    ? 'bg-purple-500/20'
                    : 'bg-white/20 hover:bg-white/30'
                }`}
              >
                <p className="text-white">{story.content}</p>
                {revealed && index === correctIndex && story.redditUrl && (
                  <a
                    href={story.redditUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-300 hover:text-blue-400 text-sm mt-2 block"
                  >
                    View on Reddit →
                  </a>
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
