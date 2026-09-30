/**
 * Nuvio Provider for LookMovie2
 * 
 * Supports:
 * - Movies & TV Series
 * - Multiple stream qualities (1080p, 720p, 480p, etc.)
 * - Subtitles (multi-language VTT)
 * - Optional LookMovie user account authentication (for HD/1080p streams)
 * - Custom domain / mirror configuration to bypass ISP / DNS blocks
 * 
 * Complies with Nuvio's Promise-based QuickJS sandbox specification.
 */

var DEFAULT_DOMAIN = "https://lookmovie2.to";
var FALLBACK_TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Returns user-configured settings or defaults.
 */
function getSettings() {
    var s = (typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS) ? globalThis.SCRAPER_SETTINGS : {};
    var domain = (s.domain && typeof s.domain === "string" && s.domain.trim()) ? s.domain.trim() : DEFAULT_DOMAIN;
    if (domain.endsWith("/")) {
        domain = domain.slice(0, -1);
    }
    return {
        domain: domain,
        email: s.email ? String(s.email).trim() : "",
        password: s.password ? String(s.password).trim() : "",
        preferredQuality: s.preferredQuality || "All"
    };
}

/**
 * Normalizes title for search comparison.
 */
function sanitizeTitle(str) {
    if (!str) return "";
    return str.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

/**
 * Helper to fetch JSON via Promise.
 */
function requestJson(url, options) {
    options = options || {};
    return fetch(url, options).then(function(res) {
        if (!res.ok) {
            throw new Error("HTTP error " + res.status + " on " + url);
        }
        return res.json();
    });
}

/**
 * Helper to fetch HTML / Text via Promise.
 */
function requestText(url, options) {
    options = options || {};
    return fetch(url, options).then(function(res) {
        if (!res.ok) {
            throw new Error("HTTP error " + res.status + " on " + url);
        }
        return res.text();
    });
}

/**
 * Fetches TMDB metadata (Title, Year), supporting both TMDB numeric IDs and IMDb tt... IDs.
 */
function getTmdbMetadata(tmdbId, mediaType) {
    var apiKey = (typeof globalThis !== "undefined" && globalThis.TMDB_API_KEY) ? globalThis.TMDB_API_KEY : FALLBACK_TMDB_KEY;
    var type = (mediaType === "tv" || mediaType === "series") ? "tv" : "movie";
    var idStr = String(tmdbId || "").trim();
    var isImdb = idStr.startsWith("tt");

    var url;
    if (isImdb) {
        url = "https://api.themoviedb.org/3/find/" + encodeURIComponent(idStr) + "?api_key=" + apiKey + "&external_source=imdb_id";
    } else {
        url = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(idStr) + "?api_key=" + apiKey;
    }

    return requestJson(url).then(function(data) {
        var item = null;
        if (isImdb) {
            if (type === "tv") {
                item = (data.tv_results && data.tv_results[0]) || (data.tv_episode_results && data.tv_episode_results[0]);
            } else {
                item = (data.movie_results && data.movie_results[0]);
            }
            if (!item) {
                item = (data.movie_results && data.movie_results[0]) || (data.tv_results && data.tv_results[0]);
            }
        } else {
            item = data;
        }

        if (!item) {
            throw new Error("No metadata returned from TMDB for " + tmdbId);
        }

        var title = item.title || item.name || item.original_title || item.original_name || "";
        var date = item.release_date || item.first_air_date || "";
        var year = date ? date.split("-")[0] : "";
        return {
            title: title,
            year: year,
            mediaType: type
        };
    }).catch(function(err) {
        console.error("[LookMovie2] TMDB fetch failed for " + tmdbId + ":", err.message || err);
        return {
            title: "",
            year: "",
            mediaType: type
        };
    });
}

/**
 * Optional login to LookMovie to obtain authenticated session cookies.
 */
function loginLookMovie(domain, email, password) {
    if (!email || !password) {
        return Promise.resolve("");
    }

    var loginUrl = domain + "/account/login";
    var headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": domain + "/"
    };

    return requestText(loginUrl, { headers: headers }).then(function(html) {
        var csrfMatch = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/name="csrf-token"\s+content="([^"]+)"/);
        var csrf = csrfMatch ? csrfMatch[1] : null;
        if (!csrf) {
            console.warn("[LookMovie2] CSRF token not found, continuing as guest");
            return "";
        }

        var postBody = "_csrf=" + encodeURIComponent(csrf) +
            "&LoginForm%5Bemail%5D=" + encodeURIComponent(email) +
            "&LoginForm%5Bpassword%5D=" + encodeURIComponent(password) +
            "&LoginForm%5BrememberMe%5D=1&login-button=";

        return fetch(loginUrl, {
            method: "POST",
            headers: {
                "User-Agent": DEFAULT_USER_AGENT,
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": loginUrl,
                "Origin": domain
            },
            body: postBody,
            redirect: "manual"
        }).then(function(postRes) {
            var cookieHeader = postRes.headers.get("set-cookie") || "";
            return cookieHeader;
        });
    }).catch(function(err) {
        console.warn("[LookMovie2] Login failed, continuing as guest:", err.message);
        return "";
    });
}

/**
 * Searches LookMovie for candidate items matching title and year.
 */
function searchLookMovie(domain, title, targetYear, mediaType, sessionCookie) {
    var endpoint = (mediaType === "tv") ? "/shows/search/page/1?q=" : "/movies/search/page/1?q=";
    var searchUrl = domain + endpoint + encodeURIComponent(title);

    var headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": domain + "/"
    };
    if (sessionCookie) {
        headers["Cookie"] = sessionCookie;
    }

    return requestText(searchUrl, { headers: headers }).then(function(html) {
        var candidates = [];
        var cleanTargetTitle = sanitizeTitle(title);

        // Try parsing using regex to match items
        var itemRegex = /<div\s+class="movie-item[^"]*"[\s\S]*?(?=<div\s+class="movie-item|$)/gi;
        var match;
        while ((match = itemRegex.exec(html)) !== null) {
            var block = match[0];

            var hrefMatch = block.match(/href="([^"]+)"/);
            var yearMatch = block.match(/year">([^<]+)</i) || block.match(/-(\d{4})(?:[/?#]|$)/);
            var titleMatch = block.match(/<h6>\s*<a[^>]*>([^<]+)<\/a>/i) || block.match(/<h6>([^<]+)<\/h6>/i) || block.match(/title="([^"]+)"/i);

            if (hrefMatch) {
                var href = hrefMatch[1];
                var cYear = yearMatch ? yearMatch[1].trim() : "";
                var cTitle = titleMatch ? titleMatch[1].trim() : "";

                candidates.push({
                    href: href.startsWith("http") ? href : domain + href,
                    title: cTitle,
                    year: cYear
                });
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        // Score candidates based on title and year similarity
        var bestCandidate = null;
        var highestScore = -1;

        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var score = 0;
            var cleanCandidateTitle = sanitizeTitle(c.title);

            if (cleanCandidateTitle === cleanTargetTitle) {
                score += 10;
            } else if (cleanCandidateTitle.includes(cleanTargetTitle) || cleanTargetTitle.includes(cleanCandidateTitle)) {
                score += 5;
            }

            if (targetYear && c.year && String(c.year) === String(targetYear)) {
                score += 8;
            }

            if (score > highestScore) {
                highestScore = score;
                bestCandidate = c;
            }
        }

        return bestCandidate || candidates[0];
    });
}

/**
 * Extracts storage data (hash, expires, id) from Movie or Show play page.
 */
function extractStorageFromPage(playUrl, sessionCookie) {
    var headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": playUrl
    };
    if (sessionCookie) {
        headers["Cookie"] = sessionCookie;
    }

    return requestText(playUrl, { headers: headers }).then(function(html) {
        // Check for movie_storage
        var movieStorageMatch = html.match(/movie_storage['"]\s*\]\s*=\s*(\{[\s\S]*?\n\s*\};)/) ||
                                html.match(/movie_storage['"]\s*\]\s*=\s*(\{[\s\S]*?\});/);
        if (movieStorageMatch) {
            var raw = movieStorageMatch[1];
            var idMovie = (raw.match(/id_movie\s*:\s*["']?(\d+)["']?/) || [])[1];
            var hash = (raw.match(/hash\s*:\s*["']([^"']+)["']/) || [])[1];
            var expires = (raw.match(/expires\s*:\s*["']?(\d+)["']?/) || [])[1];
            var title = (raw.match(/title\s*:\s*["']([^"']+)["']/) || [])[1] || "";
            var year = (raw.match(/year\s*:\s*["']([^"']+)["']/) || [])[1] || "";

            if (idMovie && hash && expires) {
                return {
                    kind: "movie",
                    idMovie: idMovie,
                    hash: hash,
                    expires: expires,
                    title: title,
                    year: year
                };
            }
        }

        // Check for show_storage
        var showStorageMatch = html.match(/show_storage['"]\s*\]\s*=\s*(\{[\s\S]*?\n\s*\};)/) ||
                               html.match(/show_storage['"]\s*\]\s*=\s*(\{[\s\S]*?\});/);
        if (showStorageMatch) {
            var showRaw = showStorageMatch[1];
            var sHash = (showRaw.match(/hash\s*:\s*["']([^"']+)["']/) || [])[1];
            var sExpires = (showRaw.match(/expires\s*:\s*["']?(\d+)["']?/) || [])[1];
            var sTitle = (showRaw.match(/title\s*:\s*["']([^"']+)["']/) || [])[1] || "";
            var sYear = (showRaw.match(/year\s*:\s*["']([^"']+)["']/) || [])[1] || "";

            // Parse seasons and episodes
            var episodes = [];
            var episodeBlockRegex = /\{[^{}]*id_episode\s*:\s*["']?(\d+)["']?[^{}]*\}/g;
            var epMatch;
            while ((epMatch = episodeBlockRegex.exec(showRaw)) !== null) {
                var block = epMatch[0];
                var idEp = (block.match(/\bid_episode\s*:\s*["']?(\d+)["']?/) || [])[1];
                var season = (block.match(/\bseason\s*:\s*["']?(\d+)["']?/) || [])[1];
                var episode = (block.match(/\bepisode\s*:\s*["']?(\d+)["']?/) || [])[1];
                var epTitle = (block.match(/title\s*:\s*["']([^"']+)["']/) || [])[1] || "";

                if (idEp && season && episode) {
                    episodes.push({
                        idEpisode: idEp,
                        season: parseInt(season, 10),
                        episode: parseInt(episode, 10),
                        title: epTitle
                    });
                }
            }

            return {
                kind: "tv",
                hash: sHash,
                expires: sExpires,
                title: sTitle,
                year: sYear,
                episodes: episodes
            };
        }

        throw new Error("Neither movie_storage nor show_storage found on play page");
    });
}

/**
 * Calls LookMovie's access API endpoint to get direct stream URLs and subtitles.
 */
function fetchAccessStreams(domain, storageData, seasonNum, episodeNum, sessionCookie, refererUrl) {
    var apiUrl;
    var params = [];

    if (storageData.kind === "movie") {
        apiUrl = domain + "/api/v1/security/movie-access";
        params.push("id_movie=" + encodeURIComponent(storageData.idMovie));
        params.push("hash=" + encodeURIComponent(storageData.hash));
        params.push("expires=" + encodeURIComponent(storageData.expires));
    } else {
        // TV show episode
        var targetSeason = parseInt(seasonNum, 10) || 1;
        var targetEpisode = parseInt(episodeNum, 10) || 1;

        var matchedEp = null;
        for (var i = 0; i < storageData.episodes.length; i++) {
            var ep = storageData.episodes[i];
            if (ep.season === targetSeason && ep.episode === targetEpisode) {
                matchedEp = ep;
                break;
            }
        }

        if (!matchedEp) {
            console.error("[LookMovie2] Episode S" + targetSeason + "E" + targetEpisode + " not found");
            return Promise.resolve([]);
        }

        apiUrl = domain + "/api/v1/security/episode-access";
        params.push("id_episode=" + encodeURIComponent(matchedEp.idEpisode));
        params.push("hash=" + encodeURIComponent(storageData.hash));
        params.push("expires=" + encodeURIComponent(storageData.expires));
    }

    var fullUrl = apiUrl + "?" + params.join("&");
    var headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": refererUrl || (domain + "/")
    };
    if (sessionCookie) {
        headers["Cookie"] = sessionCookie;
    }

    return requestJson(fullUrl, { headers: headers }).then(function(json) {
        if (!json || !json.streams) {
            console.warn("[LookMovie2] No streams in access API response:", json);
            return [];
        }

        var streamsObj = json.streams;
        var subsArr = json.subtitles || [];

        // Format subtitles
        var parsedSubtitles = [];
        for (var s = 0; s < subsArr.length; s++) {
            var sub = subsArr[s];
            if (sub && sub.file) {
                var subUrl = sub.file.startsWith("http") ? sub.file : domain + sub.file;
                var lang = sub.language || "Unknown";
                parsedSubtitles.push({
                    url: subUrl,
                    language: lang,
                    name: lang
                });
            }
        }

        var results = [];
        var qualityPriority = ["2160p", "1080p", "720p", "480p", "360p", "auto"];

        // Sort qualities according to standard resolution order
        var availableQualities = Object.keys(streamsObj).sort(function(a, b) {
            var idxA = qualityPriority.indexOf(a);
            var idxB = qualityPriority.indexOf(b);
            if (idxA === -1) idxA = 99;
            if (idxB === -1) idxB = 99;
            return idxA - idxB;
        });

        for (var q = 0; q < availableQualities.length; q++) {
            var qual = availableQualities[q];
            var streamUrl = streamsObj[qual];
            if (!streamUrl || typeof streamUrl !== "string") continue;

            var streamTitle = storageData.title || "LookMovie";
            if (storageData.year) {
                streamTitle += " (" + storageData.year + ")";
            }
            if (storageData.kind === "tv") {
                streamTitle += " S" + (seasonNum < 10 ? "0" + seasonNum : seasonNum) +
                               "E" + (episodeNum < 10 ? "0" + episodeNum : episodeNum);
            }

            results.push({
                name: "LookMovie2 - " + qual.toUpperCase(),
                title: streamTitle,
                url: streamUrl,
                quality: qual,
                size: "Unknown",
                provider: "lookmovie2",
                headers: {
                    "User-Agent": DEFAULT_USER_AGENT,
                    "Referer": domain + "/"
                },
                subtitles: parsedSubtitles
            });
        }

        return results;
    });
}

/**
 * Main Nuvio getStreams entry point.
 * 
 * @param {string|number} tmdbId TMDB ID of the requested media
 * @param {string} mediaType "movie" or "tv"
 * @param {number} [seasonNum] Season number (for TV series)
 * @param {number} [episodeNum] Episode number (for TV series)
 * @returns {Promise<Array<Object>>} Promise resolving to array of stream objects
 */
/**
 * Attempts scraping across a list of candidate mirrors until streams are found.
 */
function tryScrapeWithMirrors(mirrors, index, meta, seasonNum, episodeNum, settings) {
    if (index >= mirrors.length) {
        console.warn("[LookMovie2] All mirrors exhausted for:", meta.title);
        return Promise.resolve([]);
    }

    var domain = mirrors[index];
    if (!domain) {
        return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings);
    }

    console.log("[LookMovie2] Trying mirror (" + (index + 1) + "/" + mirrors.length + "):", domain);

    return loginLookMovie(domain, settings.email, settings.password).then(function(sessionCookie) {
        return searchLookMovie(domain, meta.title, meta.year, meta.mediaType, sessionCookie).then(function(candidate) {
            if (!candidate || !candidate.href) {
                // If direct title search failed and title starts with "The ", try without "The "
                if (meta.title && meta.title.toLowerCase().startsWith("the ")) {
                    var stripped = meta.title.slice(4).trim();
                    return searchLookMovie(domain, stripped, meta.year, meta.mediaType, sessionCookie);
                }
                return null;
            }
            return candidate;
        }).then(function(candidate) {
            if (!candidate || !candidate.href) {
                console.log("[LookMovie2] No match on mirror " + domain + " for " + meta.title);
                return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings);
            }

            var playUrl = candidate.href
                .replace("/movies/view/", "/movies/play/")
                .replace("/shows/view/", "/shows/play/");

            console.log("[LookMovie2] Fetching storage metadata from:", playUrl);

            return extractStorageFromPage(playUrl, sessionCookie).then(function(storage) {
                return fetchAccessStreams(domain, storage, seasonNum, episodeNum, sessionCookie, playUrl);
            }).then(function(streams) {
                if (streams && streams.length > 0) {
                    return streams;
                }
                return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings);
            });
        });
    }).catch(function(err) {
        console.warn("[LookMovie2] Mirror " + domain + " failed (" + (err.message || err) + "), trying next...");
        return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings);
    });
}

/**
 * Main Nuvio getStreams entry point.
 * 
 * @param {string|number} tmdbId TMDB or IMDb ID of the requested media
 * @param {string} mediaType "movie" or "tv"
 * @param {number} [seasonNum] Season number (for TV series)
 * @param {number} [episodeNum] Episode number (for TV series)
 * @returns {Promise<Array<Object>>} Promise resolving to array of stream objects
 */
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
    var settings = getSettings();

    console.log("[LookMovie2] Getting streams for media ID:", tmdbId, "type:", mediaType, "S:", seasonNum, "E:", episodeNum);

    return getTmdbMetadata(tmdbId, mediaType).then(function(meta) {
        if (!meta.title) {
            console.error("[LookMovie2] Could not resolve title from media ID:", tmdbId);
            return [];
        }

        console.log("[LookMovie2] Resolved media title:", meta.title, "(" + meta.year + ")");

        // Build list of mirrors starting with user-configured domain
        var mirrorList = [settings.domain];
        var fallbackMirrors = [
            "https://lookmovie2.to",
            "https://lookmovie.ag",
            "https://lookmovie.foundation",
            "https://lookmovie2.la"
        ];
        for (var m = 0; m < fallbackMirrors.length; m++) {
            if (mirrorList.indexOf(fallbackMirrors[m]) === -1) {
                mirrorList.push(fallbackMirrors[m]);
            }
        }

        return tryScrapeWithMirrors(mirrorList, 0, meta, seasonNum, episodeNum, settings);
    }).catch(function(err) {
        console.error("[LookMovie2] Scraper error:", err && err.message ? err.message : err);
        return [];
    });
}

/**
 * Defines settings layout for Nuvio settings modal.
 */
function onSettings() {
    return Promise.resolve([
        {
            type: "header",
            label: "LookMovie2 Settings"
        },
        {
            type: "info",
            label: "Configure your LookMovie2 domain or proxy mirror and optional account credentials."
        },
        {
            type: "text",
            key: "domain",
            label: "LookMovie Domain",
            placeholder: "https://lookmovie2.la",
            description: "Active LookMovie domain or mirror (e.g. https://lookmovie2.la or https://lookmovie2.to)"
        },
        {
            type: "text",
            key: "email",
            label: "Account Email / Username",
            placeholder: "user@example.com",
            description: "Optional: Your LookMovie account login to unlock 1080p and VIP stream qualities"
        },
        {
            type: "text",
            key: "password",
            label: "Account Password",
            isPassword: true,
            placeholder: "••••••••",
            description: "Optional: Your LookMovie password"
        },
        {
            type: "select",
            key: "preferredQuality",
            label: "Quality Selection",
            options: ["All", "1080p", "720p", "480p"],
            defaultValue: "All",
            description: "Order and filter stream qualities"
        }
    ]);
}

// Module exports for Node / React Native / QuickJS
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        getStreams: getStreams,
        onSettings: onSettings
    };
}
if (typeof globalThis !== "undefined") {
    globalThis.getStreams = getStreams;
    globalThis.onSettings = onSettings;
}
