import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function fetchPostComments(permalink: string) {
  try {
    const response = await fetch(
      `https://www.reddit.com${permalink}.json`,
      {
        headers: {
          'User-Agent': 'GossAIP/1.0',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Reddit API error: ${response.status}`);
    }

    const data = await response.json();
    return data[1]?.data?.children || [];
  } catch (error) {
    console.error('Error fetching comments:', error);
    return [];
  }
}

async function calculateEngagementScore(post: any, comments: any[] = []): Promise<number> {
  // Base score from post metrics
  let score = post.score || 0;
  const commentCount = post.num_comments || 0;
  
  // Weighted scoring components
  const components = {
    upvoteScore: score * 1.0,
    commentCount: commentCount * 2.0,
    controversyBonus: post.upvote_ratio ? (post.upvote_ratio - 0.5) * 100 : 0,
    awards: (post.total_awards_received || 0) * 10,
    freshness: Math.max(0, 100 - hoursOld(post.created_utc)) * 2,
  };

  // Add comment quality metrics
  const commentScores = comments
    .filter(comment => comment?.data?.score > 20)
    .map(comment => ({
      score: comment.data.score,
      length: (comment.data.body || '').length,
      awards: comment.data.total_awards_received || 0
    }));

  const avgCommentScore = commentScores.reduce((sum, c) => sum + c.score, 0) / (commentScores.length || 1);
  const avgCommentLength = commentScores.reduce((sum, c) => sum + c.length, 0) / (commentScores.length || 1);
  
  components.commentQuality = avgCommentScore * 0.5 + avgCommentLength * 0.01;

  // Calculate final score
  const totalScore = Object.values(components).reduce((sum, score) => sum + score, 0);
  
  return totalScore;
}

function hoursOld(timestamp: number): number {
  return (Date.now() / 1000 - timestamp) / 3600;
}

async function extractMainSubject(topic: string): Promise<string> {
  // List of known public figures and common topics
  const knownFigures = [
    'elon musk', 'taylor swift', 'kanye', 'kardashian', 'trump',
    'biden', 'beyonce', 'drake', 'zuckerberg', 'gates'
  ];

  const words = topic.toLowerCase().split(' ');
  
  // Check for known figures first
  for (const figure of knownFigures) {
    if (topic.toLowerCase().includes(figure)) {
      return figure;
    }
  }

  // If no known figure found, use NLP-like approach to find main subject
  // Look for proper nouns (words starting with capital letters in original topic)
  const properNouns = topic.split(' ')
    .filter(word => word[0] === word[0].toUpperCase())
    .join(' ');
  
  if (properNouns) {
    return properNouns;
  }

  // Fallback to first two words if they're substantial
  return words.slice(0, 2)
    .filter(word => word.length > 3)
    .join(' ');
}

async function fetchRedditPosts(topic: string) {
  try {
    // Try exact phrase first
    let posts = await searchReddit(`"${topic}"`, 'day');
    let mainSubject = topic;

    // If no relevant posts, try breaking down the query
    if (!posts || posts.length === 0) {
      mainSubject = await extractMainSubject(topic);
      console.log(`No results for "${topic}", trying main subject: "${mainSubject}"`);
      
      // Try different time ranges with the main subject
      posts = await searchReddit(mainSubject, 'day') ||
              await searchReddit(mainSubject, 'week') ||
              await searchReddit(mainSubject, 'month');
    }

    if (!posts || posts.length === 0) {
      throw new Error(`No posts found for "${topic}" or "${mainSubject}"`);
    }

    // Fetch comments and calculate engagement for relevant posts
    const postsWithEngagement = await Promise.all(
      posts.map(async (post: any) => {
        const comments = await fetchPostComments(post.permalink);
        const engagementScore = await calculateEngagementScore(post, comments);
        
        // Extract interesting comments
        const topComments = comments
          .filter((comment: any) => 
            comment?.data?.score > 50 && 
            comment?.data?.body && 
            comment?.data?.body.length > 20
          )
          .map((comment: any) => comment.data.body)
          .slice(0, 3);

        return {
          ...post,
          engagementScore,
          topComments,
          mainSubject,
          isPartialMatch: mainSubject !== topic
        };
      })
    );

    // Sort by engagement score and return top results
    return postsWithEngagement
      .sort((a, b) => b.engagementScore - a.engagementScore)
      .slice(0, 5);
  } catch (error) {
    console.error('Error fetching Reddit posts:', error);
    throw error;
  }
}

async function searchReddit(query: string, timeRange: 'day' | 'week' | 'month'): Promise<any[]> {
  const gossipSubreddits = [
    'entertainment', 'Deuxmoi', 'popculturechat', 'celebritygossip', 
    'popheads', 'BravoRealHousewives', 'KUWTK', 'blogsnark', 'HollywoodGossip'
  ];
  
  try {
    // First try searching in specific gossip subreddits
    let allPosts: any[] = [];
    
    for (const subreddit of gossipSubreddits) {
      const response = await fetch(
        `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&sort=hot&t=${timeRange}&limit=10`,
        {
          headers: {
            'User-Agent': 'GossAIP/1.0',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const posts = data?.data?.children?.map((child: any) => child.data) || [];
        allPosts.push(...posts);
      }
    }

    // If not enough posts found in specific subreddits, try general search
    if (allPosts.length < 5) {
      const response = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=hot&t=${timeRange}&limit=25`,
        {
          headers: {
            'User-Agent': 'GossAIP/1.0',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const posts = data?.data?.children?.map((child: any) => child.data) || [];
        allPosts.push(...posts);
      }
    }

    // Filter for relevance and ensure posts contain actual gossip
    return allPosts.filter((post: any) => {
      const content = (post.title + ' ' + (post.selftext || '')).toLowerCase();
      const searchTerms = query.toLowerCase().split(' ');
      
      // Check if content contains the search terms
      const hasSearchTerms = searchTerms.some(term => content.includes(term));
      
      // Check if the content likely contains gossip
      const gossipIndicators = [
        'rumor', 'allegedly', 'sources say', 'insider', 'exclusive',
        'spotted', 'claims', 'reveals', 'drama', 'scandal', 'tea',
        'dating', 'breakup', 'split', 'cheating', 'divorce',
        'announcement', 'confirmed', 'denied', 'source close to'
      ];
      
      const hasGossipIndicators = gossipIndicators.some(indicator => 
        content.includes(indicator)
      );
      
      // Check post length to ensure it's substantial
      const hasSubstantialContent = post.selftext?.length > 100 || post.num_comments > 10;
      
      return hasSearchTerms && (hasGossipIndicators || hasSubstantialContent);
    });
  } catch (error) {
    console.error(`Error searching Reddit for "${query}":`, error);
    return [];
  }
}

async function formatRedditGossip(post: any, comments: any[] = []): Promise<string> {
  // Extract content from post and comments
  const postContent = post.selftext || post.title;
  const relevantComments = comments
    .filter(comment => comment?.data?.score > 50)
    .map(comment => comment.data.body)
    .slice(0, 3);

  // Split content into sentences and filter out noise
  const sentences = postContent.split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && !s.toLowerCase().includes('submission') && !s.toLowerCase().includes('posted'));

  // Try to find gossip-worthy sentences
  const gossipIndicators = [
    'rumor', 'allegedly', 'sources say', 'insider', 'exclusive',
    'spotted', 'claims', 'reveals', 'drama', 'scandal', 'tea',
    'dating', 'breakup', 'split', 'cheating', 'divorce',
    'announcement', 'confirmed', 'denied', 'source close to'
  ];

  // Score sentences based on gossip indicators and length
  const scoredSentences = sentences.map(sentence => {
    const indicators = gossipIndicators.filter(indicator => 
      sentence.toLowerCase().includes(indicator)
    );
    return {
      sentence,
      score: indicators.length * 2 + (sentence.length > 100 ? 1 : 0)
    };
  });

  // Sort by score and take the best ones
  const bestSentences = scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.sentence);

  // If we don't have enough good sentences, add some from comments
  if (bestSentences.length < 2 && relevantComments.length > 0) {
    const commentSentences = relevantComments
      .join(' ')
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20)
      .slice(0, 2);
    
    bestSentences.push(...commentSentences);
  }

  // Ensure we have at least 2-3 sentences worth of content
  const finalContent = bestSentences.length >= 2 
    ? bestSentences.join('. ') 
    : `${post.title}. ${sentences[0] || ''}`;

  return finalContent.trim() + '.';
}

async function generateFakeGossip(realGossip: string, topic: string, topComments: string[] = [], isPartialMatch: boolean = false) {
  try {
    const matchContext = isPartialMatch 
      ? `While we couldn't find exact gossip about "${topic}", here's an interesting story about ${realGossip.split(' ').slice(0, 3).join(' ')}...`
      : '';

    const commentsContext = topComments.length > 0 
      ? `Some interesting details from the discussion:\n${topComments.join('\n')}`
      : '';

    // Count sentences and approximate length of real gossip
    const realSentences = realGossip.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const targetLength = realGossip.length;

    const prompt = `${matchContext}
    Given this real gossip:
    "${realGossip}"
    
    ${commentsContext}
    
    Generate a fictional but believable gossip story about the same topic. Important requirements:
    1. Make it approximately the same length (${targetLength} characters)
    2. Use about ${realSentences.length} sentences
    3. Match the level of detail and style of the real gossip
    4. Make it engaging and playful, but equally plausible
    5. Include specific details to make it convincing
    6. Keep the same tone and format as the real gossip`;

    const response = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a creative gossip writer. Generate engaging, playful, and believable gossip stories that match the tone and format of real gossip but are entirely fictional."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 300,
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI request timeout')), 10000)
      )
    ]) as OpenAI.Chat.ChatCompletion;

    return response.choices[0].message.content?.trim() || 'Failed to generate a story';
  } catch (error) {
    console.error('Error generating fake gossip:', error);
    return `Here's some alternative gossip about ${topic}: ` +
           `Rumor has it that there's been some interesting developments, ` +
           `but we're still waiting for more details to emerge...`;
  }
}

async function generateStories(posts: any[], topic: string, recentStoryIds: string[] = []) {
  try {
    // Filter out recently shown posts
    const freshPosts = recentStoryIds.length > 0 
      ? posts.filter(post => !recentStoryIds.includes(`${post.subreddit}_${post.id}`))
      : posts;
    
    // Calculate engagement scores for all posts
    const scoredPosts = await Promise.all(
      freshPosts.map(async post => ({
        post,
        score: await calculateEngagementScore(post, post.topComments || [])
      }))
    );

    // Sort by engagement score and get the best post
    const bestPost = scoredPosts
      .sort((a, b) => b.score - a.score)
      [0]?.post;

    if (!bestPost) {
      return {
        error: `No fresh gossip found about "${topic}". Try searching for a different celebrity or check back later for new tea! ☕️`,
        suggestion: await getTrendingTopic()
      };
    }
    
    // Format the Reddit post into a gossip story
    const realStory = await formatRedditGossip(bestPost, bestPost.topComments);

    // Generate a fake version with matching length and style
    const fakeStory = await generateFakeGossip(realStory, topic, bestPost.topComments || [], bestPost.isPartialMatch);

    // Create story objects
    const stories = [
      {
        content: realStory,
        isReal: true,
        redditUrl: `https://reddit.com${bestPost.permalink}`,
        engagementScore: bestPost.engagementScore,
        isPartialMatch: bestPost.isPartialMatch,
        mainSubject: bestPost.mainSubject,
        subreddit: bestPost.subreddit,
        storyId: `${bestPost.subreddit}_${bestPost.id}`
      },
      {
        content: fakeStory,
        isReal: false,
        engagementScore: undefined,
        isPartialMatch: bestPost.isPartialMatch,
        mainSubject: bestPost.mainSubject,
        storyId: `fake_${topic}_${Date.now()}`
      }
    ];

    // Randomly shuffle the order
    const shuffledStories = shuffleArray(stories);

    return {
      stories: shuffledStories,
      correctIndex: shuffledStories.findIndex(story => story.isReal),
      newStoryIds: [stories[0].storyId]
    };
  } catch (error) {
    console.error('Error generating stories:', error);
    throw error;
  }
}

async function getTrendingTopic(): Promise<string> {
  try {
    const response = await fetch(
      'https://www.reddit.com/r/Deuxmoi/hot.json?limit=5',
      {
        headers: {
          'User-Agent': 'GossAIP/1.0',
        },
      }
    );
    
    if (!response.ok) throw new Error('Failed to fetch trending topics');
    
    const data = await response.json();
    const posts = data?.data?.children || [];
    
    // Find a post title that mentions a celebrity
    const celebrityPost = posts.find((post: any) => {
      const title = post.data.title.toLowerCase();
      return !title.includes('daily discussion') && !title.includes('megathread');
    });
    
    if (celebrityPost) {
      // Extract the main subject from the title
      const title = celebrityPost.data.title;
      const words = title.split(' ').slice(0, 3).join(' ');
      return words;
    }
    
    return 'Taylor Swift'; // Default fallback
  } catch (error) {
    console.error('Error fetching trending topic:', error);
    return 'Taylor Swift'; // Default fallback
  }
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const topic = url.searchParams.get('topic');
    const recentStoryIds = url.searchParams.get('recentStories') 
      ? JSON.parse(url.searchParams.get('recentStories')!)
      : [];

    if (!topic) {
      try {
        const trendingResponse = await fetch('https://www.reddit.com/r/popular/hot.json?limit=1', {
          headers: {
            'User-Agent': 'GossAIP/1.0',
          },
        });

        if (!trendingResponse.ok) {
          throw new Error('Failed to fetch trending topics');
        }

        const trendingData = await trendingResponse.json();
        const trendingTopic = trendingData?.data?.children?.[0]?.data?.title;

        if (!trendingTopic) {
          throw new Error('No trending topics found');
        }

        return NextResponse.json({ error: 'Topic is required', suggestion: trendingTopic }, { status: 400 });
      } catch (error) {
        return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
      }
    }

    const posts = await fetchRedditPosts(topic);

    if (!posts || posts.length === 0) {
      return NextResponse.json(
        { error: 'No relevant posts found', suggestion: 'Try a different or broader topic' },
        { status: 404 }
      );
    }

    // Generate stories using multiple Reddit posts
    const { stories, correctIndex, newStoryIds } = await generateStories(posts, topic, recentStoryIds);

    return NextResponse.json({
      stories,
      correctIndex,
      originalTopic: topic,
      mainSubject: posts[0].mainSubject,
      isPartialMatch: posts[0].isPartialMatch,
      newStoryIds // Client will add these to their localStorage
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Failed to process request', message: error.message },
      { status: 500 }
    );
  }
}
