import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { GossipStory } from '@/types/gossip';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable');
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function fetchRedditPosts(topic: string) {
  try {
    // First try to get posts from the last day
    let response = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=hot&t=day&limit=10`,
      {
        headers: {
          'User-Agent': 'GossAIP/1.0',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Reddit API error: ${response.status}`);
    }

    let data = await response.json();
    let posts = data?.data?.children?.map((child: any) => child.data) || [];

    // If no posts found in the last day, try the last week
    if (posts.length === 0) {
      response = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(topic)}&sort=hot&t=week&limit=10`,
        {
          headers: {
            'User-Agent': 'GossAIP/1.0',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Reddit API error: ${response.status}`);
      }

      data = await response.json();
      posts = data?.data?.children?.map((child: any) => child.data) || [];
    }

    // Filter out posts that don't seem relevant
    const relevantPosts = posts.filter((post: any) => {
      const titleLower = post.title.toLowerCase();
      const topicLower = topic.toLowerCase();
      return (
        titleLower.includes(topicLower) ||
        (post.selftext && post.selftext.toLowerCase().includes(topicLower))
      );
    });

    if (relevantPosts.length === 0) {
      throw new Error('No relevant posts found');
    }

    return relevantPosts;
  } catch (error) {
    console.error('Error fetching Reddit posts:', error);
    throw error;
  }
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
        console.error('Error fetching trending topic:', error);
        return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
      }
    }

    const posts = await fetchRedditPosts(topic);
    
    // Select a random post from the top 5 most engaging posts
    const topPosts = posts
      .sort((a: any, b: any) => {
        const scoreA = (a.score || 0) * 1.5 + (a.num_comments || 0);
        const scoreB = (b.score || 0) * 1.5 + (b.num_comments || 0);
        return scoreB - scoreA;
      })
      .slice(0, 5);
    
    const selectedPost = topPosts[Math.floor(Math.random() * topPosts.length)];

    if (!selectedPost) {
      return NextResponse.json({ error: 'No suitable posts found' }, { status: 404 });
    }

    // Generate the real gossip summary
    const realGossipResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a gossip columnist. Create a short, engaging, and playful summary of news and stories in a gossip style. Keep it concise, around 2-3 sentences. Do not use any quotes or special formatting."
        },
        {
          role: "user",
          content: `Summarize this Reddit post into a short, playful gossip-style paragraph (2-3 sentences, no quotes):
          Title: ${selectedPost.title}
          Content: ${selectedPost.selftext?.substring(0, 500) || selectedPost.title}`
        }
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    const realGossip = realGossipResponse.choices[0].message.content?.trim().replace(/^["']|["']$/g, '') || '';

    // Extract key elements from the real gossip
    const styleAnalysisResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Analyze the given gossip and extract key elements like names, places, events, and writing style patterns."
        },
        {
          role: "user",
          content: `Analyze this gossip and list key elements that make it sound authentic:
          ${realGossip}`
        }
      ],
      temperature: 0.5,
      max_tokens: 100,
    });

    const styleAnalysis = styleAnalysisResponse.choices[0].message.content?.trim() || '';

    // Generate two fake gossip stories using the style analysis
    const fakeGossipResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Generate two short, fictional but believable gossip stories. Each story should be 2-3 sentences and match the style of the real gossip. Use similar tone, structure, and gossip elements, but with different content. Make them tricky to distinguish from the real one. Do not use any quotes or special formatting."
        },
        {
          role: "user",
          content: `Create two different fictional gossip stories about "${topic}" that closely match this style:
          Real gossip: ${realGossip}
          Style elements: ${styleAnalysis}
          
          Make the fake stories sound very similar but with different events/details. Do not use quotes.`
        }
      ],
      temperature: 0.8,
      max_tokens: 200,
    });

    const fakeGossips = fakeGossipResponse.choices[0].message.content?.split('\n\n')
      .filter(gossip => gossip?.trim()?.length > 0)
      .map(gossip => gossip.replace(/^\d+\.\s*/, '').trim())
      .map(gossip => gossip.replace(/^["']|["']$/g, '').trim()) // Remove any quotes
      .slice(0, 2) || [];

    if (fakeGossips.length < 2) {
      throw new Error('Failed to generate fake gossip stories');
    }

    // Create the stories array and shuffle
    const stories: GossipStory[] = [
      { content: realGossip, isReal: true, redditUrl: `https://reddit.com${selectedPost.permalink}` },
      ...fakeGossips.map(content => ({ content, isReal: false }))
    ];

    // Shuffle the stories
    const shuffledStories = [...stories].sort(() => Math.random() - 0.5);
    const correctIndex = shuffledStories.findIndex(story => story.isReal);

    return NextResponse.json({
      topic,
      stories: shuffledStories,
      correctIndex
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to generate gossip'
    }, { 
      status: 500 
    });
  }
}
