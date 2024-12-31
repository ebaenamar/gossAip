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

function calculateEngagementScore(post: any, comments: any[]) {
  const postScore = post.score || 0;
  const commentCount = post.num_comments || 0;
  const controversialityScore = post.controversiality || 0;
  
  // Calculate average comment score and depth
  let totalCommentScore = 0;
  let maxCommentDepth = 0;
  let topCommentCount = 0;
  
  const processComment = (comment: any, depth: number = 0) => {
    if (comment?.data?.score) {
      totalCommentScore += comment.data.score;
      maxCommentDepth = Math.max(maxCommentDepth, depth);
      
      // Count highly upvoted comments
      if (comment.data.score > 100) {
        topCommentCount++;
      }
      
      // Process replies recursively
      if (comment.data.replies?.data?.children) {
        comment.data.replies.data.children.forEach((reply: any) => 
          processComment(reply, depth + 1)
        );
      }
    }
  };
  
  comments.forEach(comment => processComment(comment));
  
  const avgCommentScore = comments.length > 0 ? totalCommentScore / comments.length : 0;
  
  // Weighted scoring formula
  return (
    postScore * 0.4 +                    // Post score weight
    commentCount * 0.2 +                 // Comment count weight
    avgCommentScore * 0.2 +             // Average comment score weight
    maxCommentDepth * 50 +              // Discussion depth bonus
    topCommentCount * 100 +             // Popular comments bonus
    (controversialityScore * 50)         // Controversy bonus
  );
}

function extractMainSubject(topic: string): string {
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
      mainSubject = extractMainSubject(topic);
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
        const engagementScore = calculateEngagementScore(post, comments);
        
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
  // Extract the most relevant part of the post
  const content = post.selftext || post.title;
  const sentences = content.split(/[.!?]+/).filter(Boolean);
  
  // Try to find the most gossip-worthy sentences
  const gossipIndicators = [
    'rumor', 'allegedly', 'sources say', 'insider', 'exclusive',
    'spotted', 'claims', 'reveals', 'drama', 'scandal', 'tea'
  ];
  
  const relevantSentences = sentences.filter(sentence => 
    gossipIndicators.some(indicator => 
      sentence.toLowerCase().includes(indicator)
    )
  );
  
  // If no gossip-specific sentences found, use the first few sentences
  const gossipContent = relevantSentences.length > 0 
    ? relevantSentences.slice(0, 2).join('. ')
    : sentences.slice(0, 2).join('. ');
    
  // Add context from top comments if available
  const topComment = comments
    .filter(comment => comment?.data?.score > 50)
    .map(comment => comment.data.body)
    .slice(0, 1)
    .join(' ');
    
  return `${gossipContent}${topComment ? ` ${topComment}` : ''}`;
}

async function generateStories(posts: any[], topic: string, recentStoryIds: string[] = []) {
  try {
    // Filter out recently shown posts
    const freshPosts = recentStoryIds.length > 0 
      ? posts.filter(post => !recentStoryIds.includes(`${post.subreddit}_${post.id}`))
      : posts;
    
    // Use fresh posts if available, otherwise fall back to all posts
    const postsToUse = freshPosts.length > 0 ? freshPosts : posts;
    
    if (postsToUse.length === 0) {
      return {
        error: `No fresh gossip found about "${topic}". Try searching for a different celebrity or check back later for new tea! ☕️`,
        suggestion: await getTrendingTopic()
      };
    }
    
    // Get the highest engagement post
    const bestPost = postsToUse[0];
    
    // Format the Reddit post into a gossip story
    const realStory = await formatRedditGossip(bestPost, bestPost.topComments);

    // Generate a fake version
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

async function generateFakeGossip(realGossip: string, topic: string, topComments: string[] = [], isPartialMatch: boolean = false) {
  try {
    const matchContext = isPartialMatch 
      ? `While we couldn't find exact gossip about "${topic}", here's an interesting story about ${realGossip.split(' ').slice(0, 3).join(' ')}...`
      : '';

    const commentsContext = topComments.length > 0 
      ? `Some interesting details from the discussion:\n${topComments.join('\n')}`
      : '';

    const prompt = `${matchContext}
    Given this real gossip:
    "${realGossip}"
    
    ${commentsContext}
    
    Generate a fictional but believable gossip story about the same topic. Make it engaging and playful, matching the tone of the real gossip. The story should be different but equally plausible. Include some specific details to make it more convincing.`;

    const response = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a creative gossip writer. Generate engaging, playful, and believable gossip stories that match the tone of real gossip but are entirely fictional."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8,
        max_tokens: 200,
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
