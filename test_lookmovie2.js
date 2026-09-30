/**
 * Test script for Nuvio LookMovie2 Scraper
 * 
 * Run with: node test_lookmovie2.js
 */

const { getStreams, onSettings } = require("./providers/lookmovie2.js");

async function runTests() {
    console.log("=== Testing LookMovie2 Nuvio Plugin ===");

    // Test Settings Layout
    console.log("\n1. Testing onSettings()...");
    const settings = await onSettings();
    console.log("Settings Layout Fields:", settings.map(f => f.label || f.key));

    // Test Movie (TMDB 550 = Fight Club, or 27205 = Inception)
    console.log("\n2. Testing getStreams for Movie (TMDB 27205 - Inception)...");
    try {
        const movieStreams = await getStreams("27205", "movie");
        console.log(`Found ${movieStreams.length} stream(s):`);
        movieStreams.forEach((s, idx) => {
            console.log(` [${idx + 1}] ${s.name} (${s.quality}): ${s.url}`);
            if (s.subtitles && s.subtitles.length > 0) {
                console.log(`     Subtitles: ${s.subtitles.length} language(s)`);
            }
        });
    } catch (e) {
        console.error("Movie test error:", e);
    }

    // Test TV Series (TMDB 1396 = Breaking Bad, S1E1)
    console.log("\n3. Testing getStreams for TV Show (TMDB 1396 - Breaking Bad S1E1)...");
    try {
        const tvStreams = await getStreams("1396", "tv", 1, 1);
        console.log(`Found ${tvStreams.length} stream(s):`);
        tvStreams.forEach((s, idx) => {
            console.log(` [${idx + 1}] ${s.name} (${s.quality}): ${s.url}`);
        });
    } catch (e) {
        console.error("TV test error:", e);
    }

    console.log("\n=== Test Complete ===");
}

runTests();
