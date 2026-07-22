const Parser = require("rss-parser");
const Blog = require("../models/blog.model");

const parser = new Parser({
  timeout: 3500, // Reduced from 10s to 3.5s per feed (was causing 30s+ delays)
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; AuraInteriors/1.0)",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
      ["enclosure", "enclosure"],
      ["content:encoded", "contentEncoded"],
      ["dc:creator", "creator"],
    ],
  },
});

// Interior design RSS feeds
const RSS_FEEDS = [
  {
    name: "Dezeen",
    url: "https://www.dezeen.com",
    feedUrl: "https://www.dezeen.com/interiors/feed/",
    logo: "https://static.dezeen.com/uploads/2020/07/dezeen-logo-1.png",
    category: "inspiration",
  },
  {
    name: "Architectural Digest",
    url: "https://www.architecturaldigest.com",
    feedUrl: "https://www.architecturaldigest.com/feed/rss",
    logo: "https://www.architecturaldigest.com/verso/static/ad/assets/logo.svg",
    category: "design-tips",
  },
  {
    name: "Design Milk",
    url: "https://design-milk.com",
    feedUrl: "https://design-milk.com/feed/",
    logo: "https://design-milk.com/images/design-milk-logo.svg",
    category: "trends",
  },
  {
    name: "Apartment Therapy",
    url: "https://www.apartmenttherapy.com",
    feedUrl: "https://www.apartmenttherapy.com/main.rss",
    logo: "https://www.apartmenttherapy.com/static/images/at-logo.svg",
    category: "small-spaces",
  },
  {
    name: "Freshome",
    url: "https://freshome.com",
    feedUrl: "https://freshome.com/feed/",
    logo: "https://freshome.com/wp-content/uploads/2019/05/freshome-logo.png",
    category: "inspiration",
  },
  {
    name: "Dwell",
    url: "https://www.dwell.com",
    feedUrl: "https://www.dwell.com/feed",
    logo: "https://www.dwell.com/assets/dwell-logo.svg",
    category: "styling",
  },
  {
    name: "Interior Design Magazine",
    url: "https://www.interiordesign.net",
    feedUrl: "https://www.interiordesign.net/rss/",
    logo: "https://www.interiordesign.net/images/id-logo.svg",
    category: "news",
  },
  {
    name: "Houzz",
    url: "https://www.houzz.com",
    feedUrl: "https://www.houzz.com/ideabooks/rss/",
    logo: "https://st.hzcdn.com/static/images/logo/hz-logo.svg",
    category: "guides",
  },
];

/**
 * Extract image URL from RSS item
 */
function extractImageUrl(item) {
  // Try various image sources
  if (item.mediaContent?.$ ?.url) {
    return item.mediaContent.$.url;
  }
  if (item.mediaThumbnail?.$ ?.url) {
    return item.mediaThumbnail.$.url;
  }
  if (item.enclosure?.url && item.enclosure.type?.startsWith("image")) {
    return item.enclosure.url;
  }

  // Try to extract from content
  const content = item.contentEncoded || item.content || item.contentSnippet || "";
  const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) {
    return imgMatch[1];
  }

  // Default placeholder
  return null;
}

/**
 * Extract excerpt from content
 */
function extractExcerpt(item, maxLength = 300) {
  let text = item.contentSnippet || item.content || item.description || "";

  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, "");

  // Remove extra whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Truncate to max length
  if (text.length > maxLength) {
    text = text.substring(0, maxLength).trim() + "...";
  }

  return text;
}

/**
 * Determine category based on content keywords
 */
function determineCategory(item, defaultCategory) {
  const text = `${item.title} ${item.contentSnippet || ""} ${item.categories?.join(" ") || ""}`.toLowerCase();

  if (text.match(/small\s*space|apartment|compact|studio/)) {
    return "small-spaces";
  }
  if (text.match(/sustainable|eco|green|recycl/)) {
    return "sustainability";
  }
  if (text.match(/trend|new|2024|2025|latest/)) {
    return "trends";
  }
  if (text.match(/how\s*to|guide|tips|diy/)) {
    return "guides";
  }
  if (text.match(/style|color|decor|decorat/)) {
    return "styling";
  }
  if (text.match(/design\s*tip|rule|principle/)) {
    return "design-tips";
  }
  if (text.match(/news|announce|launch|open/)) {
    return "news";
  }

  return defaultCategory;
}

/**
 * Extract tags from item
 */
function extractTags(item) {
  const tags = [];

  // Add RSS categories as tags
  if (item.categories) {
    tags.push(...item.categories.slice(0, 5));
  }

  // Extract keywords from title
  const titleWords = item.title
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 4 && !["about", "these", "their", "would", "could", "should"].includes(word))
    .slice(0, 3);

  tags.push(...titleWords);

  // Remove duplicates and limit
  return [...new Set(tags)].slice(0, 8);
}

/**
 * Fetch and parse a single RSS feed
 */
async function fetchFeed(feedConfig) {
  try {
    console.log(`Fetching feed: ${feedConfig.name}`);
    const feed = await parser.parseURL(feedConfig.feedUrl);

    const articles = [];

    for (const item of feed.items.slice(0, 10)) {
      // Skip if no title or link
      if (!item.title || !item.link) continue;

      // Check if article already exists
      const exists = await Blog.findOne({ originalUrl: item.link });
      if (exists) continue;

      const article = {
        title: item.title.trim(),
        excerpt: extractExcerpt(item),
        content: item.contentEncoded || item.content || item.contentSnippet || "",
        featuredImage: extractImageUrl(item),
        category: determineCategory(item, feedConfig.category),
        tags: extractTags(item),
        source: {
          name: feedConfig.name,
          url: feedConfig.url,
          feedUrl: feedConfig.feedUrl,
          logo: feedConfig.logo,
        },
        originalUrl: item.link,
        author: {
          name: item.creator || item.author || `${feedConfig.name} Editorial`,
        },
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
      };

      articles.push(article);
    }

    return articles;
  } catch (error) {
    console.error(`Error fetching feed ${feedConfig.name}:`, error.message);
    return [];
  }
}

/**
 * Fetch all RSS feeds in PARALLEL and save to database
 * Replaces sequential processing to prevent blocking the API request loop
 */
async function fetchAllFeeds() {
  const startTime = Date.now();
  console.log("[RSS] 📰 Starting parallel RSS feed fetch for all feeds...");

  // Fetch all feeds in parallel using Promise.allSettled
  // This prevents one slow/failed feed from blocking others
  const fetchPromises = RSS_FEEDS.map((feedConfig) => fetchFeed(feedConfig));
  const results = await Promise.allSettled(fetchPromises);

  let totalNew = 0;
  let totalErrors = 0;
  let failedFeeds = 0;

  // Process results and save articles
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const feedConfig = RSS_FEEDS[i];

    if (result.status === "rejected") {
      console.error(`[RSS] ✗ ${feedConfig.name}: Fetch failed - ${result.reason?.message || result.reason}`);
      totalErrors++;
      failedFeeds++;
      continue;
    }

    const articles = result.value;
    
    for (const article of articles) {
      try {
        await Blog.create(article);
        totalNew++;
      } catch (err) {
        if (err.code !== 11000) { // Skip duplicate key errors silently
          console.error(`[RSS] Error saving article from ${feedConfig.name}: ${err.message}`);
          totalErrors++;
        }
      }
    }

    console.log(`[RSS] ✓ ${feedConfig.name}: ${articles.length} new articles`);
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `[RSS] ✓ Parallel fetch complete in ${elapsed}ms: ${totalNew} new articles, ${failedFeeds} feeds failed, ${totalErrors} save errors`
  );

  return { newArticles: totalNew, errors: totalErrors, duration: elapsed };
}

/**
 * Get available feed sources
 */
function getFeedSources() {
  return RSS_FEEDS.map((feed) => ({
    name: feed.name,
    url: feed.url,
    logo: feed.logo,
    category: feed.category,
  }));
}

/**
 * Mark random articles as featured (for variety)
 */
async function updateFeaturedArticles(count = 5) {
  // Unfeature all
  await Blog.updateMany({}, { isFeatured: false });

  // Feature random recent articles
  const recentArticles = await Blog.find()
    .sort({ publishedAt: -1 })
    .limit(50);

  if (recentArticles.length === 0) return;

  // Shuffle and pick
  const shuffled = recentArticles.sort(() => 0.5 - Math.random());
  const featured = shuffled.slice(0, Math.min(count, shuffled.length));

  for (const article of featured) {
    article.isFeatured = true;
    await article.save({ validateBeforeSave: false });
  }

  console.log(`Updated ${featured.length} featured articles`);
}

module.exports = {
  fetchAllFeeds,
  fetchFeed,
  getFeedSources,
  updateFeaturedArticles,
  RSS_FEEDS,
};
