/**
 * Test script for Nuvio LookMovie2 Scraper
 * 
 * Run with: node test_lookmovie2.js
 */

const dns = require("dns");
const origLookup = dns.lookup;
dns.lookup = function(hostname, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    if (hostname.includes("lookmovie2.to")) {
        if (options && options.all) return callback(null, [{ address: "178.215.227.42", family: 4 }]);
        return callback(null, "178.215.227.42", 4);
    }
    return origLookup(hostname, options, callback);
};

const { getStreams, onSettings } = require("./providers/lookmovie2.js");

async function runTests() {
    console.log("=== Testing LookMovie2 Nuvio Plugin ===");

    // Test Settings Layout
    console.log("\n1. Testing onSettings()...");
    const settings = await onSettings();
    console.log("Settings Layout Fields:", settings.map(f => f.label || f.key));

    // Test Movie (TMDB 603 = The Matrix)
    console.log("\n2. Testing getStreams for Movie (TMDB 603 - The Matrix)...");
    try {
        const movieStreams = await getStreams("603", "movie");
        console.log(`Found ${movieStreams.length} movie stream(s):`);
        movieStreams.forEach((s, idx) => {
            console.log(` [${idx + 1}] ${s.name} (${s.quality}): ${s.url.slice(0, 80)}...`);
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
        console.log(`Found ${tvStreams.length} TV stream(s):`);
        tvStreams.forEach((s, idx) => {
            console.log(` [${idx + 1}] ${s.name} (${s.quality}): ${s.url.slice(0, 80)}...`);
            if (s.subtitles && s.subtitles.length > 0) {
                console.log(`     Subtitles: ${s.subtitles.length} language(s)`);
            }
        });
    } catch (e) {
        console.error("TV test error:", e);
    }

    console.log("\n=== Test Complete ===");
}

runTests();
