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
  try {
    const response = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}\u0026sort=hot\u0026t=${timeRange}\u0026limit=15`,
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
    const posts = data?.data?.children?.map((child: any) => child.data) || [];

    // Filter for relevance
    return posts.filter((post: any) => {
      const content = (post.title + ' ' + (post.selftext || '')).toLowerCase();
      const searchTerms = query.toLowerCase().split(' ');
      return searchTerms.some(term => content.includes(term));
    });
  } catch (error) {
    console.error(`Error searching Reddit for "${query}":`, error);
    return [];
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

    // Select the post with highest engagement score
    const selectedPost = posts[0];
    const realGossip = selectedPost.title + (selectedPost.selftext ? ` ${selectedPost.selftext}` : '');

    // Generate fake gossip using both the post and top comments
    const fakeGossip = await generateFakeGossip(realGossip, topic, selectedPost.topComments, selectedPost.isPartialMatch);

    // Randomly decide whether to show the real gossip first or second
    const isRealFirst = Math.random() < 0.5;
    const stories = [
      {
        content: isRealFirst ? realGossip : fakeGossip,
        isReal: isRealFirst,
        redditUrl: isRealFirst ? `https://reddit.com${selectedPost.permalink}` : undefined,
        engagementScore: isRealFirst ? selectedPost.engagementScore : undefined,
        isPartialMatch: selectedPost.isPartialMatch,
        mainSubject: selectedPost.mainSubject
      },
      {
        content: isRealFirst ? fakeGossip : realGossip,
        isReal: !isRealFirst,
        redditUrl: !isRealFirst ? `https://reddit.com${selectedPost.permalink}` : undefined,
        engagementScore: !isRealFirst ? selectedPost.engagementScore : undefined,
        isPartialMatch: selectedPost.isPartialMatch,
        mainSubject: selectedPost.mainSubject
      }
    ];

    return NextResponse.json({
      stories,
      correctIndex: isRealFirst ? 0 : 1,
      originalTopic: topic,
      mainSubject: selectedPost.mainSubject,
      isPartialMatch: selectedPost.isPartialMatch
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Failed to process request', message: error.message },
      { status: 500 }
    );
  }
}
