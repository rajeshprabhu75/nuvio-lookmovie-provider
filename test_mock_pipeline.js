/**
 * Mock Pipeline Test for LookMovie2 Scraper
 * Verifies HTML parsing, storage extraction, episode matching, and stream result formation.
 */

const assert = require("assert");

// Mock HTML for movie search
const mockMovieSearchHtml = `
<div class="movie-item">
    <a href="/movies/view/1234-inception-2010">
        <div class="year">2010</div>
        <h6><a href="/movies/view/1234-inception-2010">Inception</a></h6>
    </a>
</div>
<div class="movie-item">
    <a href="/movies/view/5678-inception-the-cobol-job-2010">
        <div class="year">2010</div>
        <h6><a href="/movies/view/5678-inception-the-cobol-job-2010">Inception: The Cobol Job</a></h6>
    </a>
</div>
`;

// Mock HTML for movie play page
const mockMoviePlayHtml = `
<!DOCTYPE html>
<html>
<head><title>Watch Inception</title></head>
<body>
<script>
window["movie_storage"] = {
    id_movie: 12345,
    title: "Inception",
    year: "2010",
    hash: "ab12cd34ef56",
    expires: 1735689600
};
</script>
</body>
</html>
`;

// Mock JSON response from /api/v1/security/movie-access
const mockMovieAccessJson = {
    streams: {
        "1080p": "https://storage.lookmovie2.la/movies/12345/1080p/master.m3u8",
        "720p": "https://storage.lookmovie2.la/movies/12345/720p/master.m3u8",
        "480p": "https://storage.lookmovie2.la/movies/12345/480p/master.m3u8"
    },
    subtitles: [
        {
            language: "English",
            file: "/subtitles/12345/en.vtt",
            country: "US"
        },
        {
            language: "Spanish",
            file: "/subtitles/12345/es.vtt",
            country: "ES"
        }
    ]
};

// Mock HTML for show play page
const mockShowPlayHtml = `
<script>
window["show_storage"] = {
    title: "Breaking Bad",
    year: "2008",
    hash: "showhash9876",
    expires: 1735689600,
    seasons: [
        { id_episode: 901, season: "1", episode: "1", title: "Pilot" },
        { id_episode: 902, season: "1", episode: "2", title: "Cat's in the Bag..." },
        { id_episode: 903, season: "2", episode: "1", title: "Seven Thirty-Seven" }
    ]
};
</script>
`;

console.log("=== Running LookMovie2 Pipeline Unit Tests ===");

// 1. Test search regex
console.log("Testing search extraction...");
const itemRegex = /<div\s+class="movie-item[^"]*"[\s\S]*?(?=<div\s+class="movie-item|$)/gi;
let candidates = [];
let match;
while ((match = itemRegex.exec(mockMovieSearchHtml)) !== null) {
    const block = match[0];
    const hrefMatch = block.match(/href="([^"]+)"/);
    const yearMatch = block.match(/year">([^<]+)</i);
    const titleMatch = block.match(/<h6>\s*<a[^>]*>([^<]+)<\/a>/i);
    if (hrefMatch) {
        candidates.push({
            href: hrefMatch[1],
            title: titleMatch ? titleMatch[1].trim() : "",
            year: yearMatch ? yearMatch[1].trim() : ""
        });
    }
}

assert.strictEqual(candidates.length, 2, "Should find 2 search items");
assert.strictEqual(candidates[0].title, "Inception");
assert.strictEqual(candidates[0].year, "2010");
console.log(" Search regex extraction passed!");

// 2. Test movie_storage extraction
console.log("Testing movie_storage extraction...");
const movieStorageMatch = mockMoviePlayHtml.match(/movie_storage"\]\s*=\s*(\{[\s\S]*?\});/);
assert(movieStorageMatch, "movie_storage should be found");
const raw = movieStorageMatch[1];
const idMovie = (raw.match(/id_movie\s*:\s*["']?(\d+)["']?/) || [])[1];
const hash = (raw.match(/hash\s*:\s*["']([^"']+)["']/) || [])[1];
const expires = (raw.match(/expires\s*:\s*["']?(\d+)["']?/) || [])[1];

assert.strictEqual(idMovie, "12345");
assert.strictEqual(hash, "ab12cd34ef56");
assert.strictEqual(expires, "1735689600");
console.log(" Movie storage extraction passed!");

// 3. Test show_storage extraction
console.log("Testing show_storage extraction...");
const showStorageMatch = mockShowPlayHtml.match(/show_storage"\]\s*=\s*(\{[\s\S]*?\});/);
assert(showStorageMatch, "show_storage should be found");
const showRaw = showStorageMatch[1];
const sHash = (showRaw.match(/hash\s*:\s*["']([^"']+)["']/) || [])[1];
const sExpires = (showRaw.match(/expires\s*:\s*["']?(\d+)["']?/) || [])[1];

const episodes = [];
const epRegex = /\{[^{}]*id_episode\s*:\s*["']?(\d+)["']?[^{}]*\}/g;
let epMatch;
while ((epMatch = epRegex.exec(showRaw)) !== null) {
    const block = epMatch[0];
    const idEp = (block.match(/\bid_episode\s*:\s*["']?(\d+)["']?/) || [])[1];
    const season = (block.match(/\bseason\s*:\s*["']?(\d+)["']?/) || [])[1];
    const episode = (block.match(/\bepisode\s*:\s*["']?(\d+)["']?/) || [])[1];
    const epTitle = (block.match(/title\s*:\s*["']([^"']+)["']/) || [])[1] || "";
    episodes.push({
        idEpisode: idEp,
        season: parseInt(season, 10),
        episode: parseInt(episode, 10),
        title: epTitle
    });
}

assert.strictEqual(episodes.length, 3, "Should extract 3 episodes");
assert.strictEqual(episodes[0].idEpisode, "901");
assert.strictEqual(episodes[0].season, 1);
assert.strictEqual(episodes[0].episode, 1);
console.log(" Show storage & episodes extraction passed!");

// 4. Test Stream Results Formatting
console.log("Testing stream output formatting...");
const domain = "https://lookmovie2.la";
const parsedSubtitles = mockMovieAccessJson.subtitles.map(s => ({
    url: s.file.startsWith("http") ? s.file : domain + s.file,
    language: s.language,
    name: s.language
}));

const qualityPriority = ["2160p", "1080p", "720p", "480p", "360p", "auto"];
const availableQualities = Object.keys(mockMovieAccessJson.streams).sort((a, b) => {
    return qualityPriority.indexOf(a) - qualityPriority.indexOf(b);
});

const streams = availableQualities.map(q => ({
    name: "LookMovie2 - " + q.toUpperCase(),
    title: "Inception (2010)",
    url: mockMovieAccessJson.streams[q],
    quality: q,
    size: "Unknown",
    provider: "lookmovie2",
    headers: {
        "User-Agent": "Mozilla/5.0...",
        "Referer": domain + "/"
    },
    subtitles: parsedSubtitles
}));

assert.strictEqual(streams.length, 3);
assert.strictEqual(streams[0].quality, "1080p");
assert.strictEqual(streams[0].subtitles.length, 2);
assert.strictEqual(streams[0].subtitles[0].url, "https://lookmovie2.la/subtitles/12345/en.vtt");
console.log(" Stream result formatting passed!");

console.log("\nALL UNIT TESTS PASSED SUCCESSFULLY! \n");
