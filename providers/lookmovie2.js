/**
 * Nuvio Provider for LookMovie2
 * 
 * Supports:
 * - Movies & TV Series
 * - Multiple stream qualities (1080p, 720p, 480p, etc.)
 * - Subtitles (multi-language VTT)
 * - LookMovie user account authentication (unlocks 1080p & 720p HD streams)
 * - Real-time diagnostics: mirror domain connected, auth status, login failure reasons
 * - Custom domain / mirror configuration to bypass ISP / DNS blocks
 * 
 * Complies with Nuvio's Promise-based QuickJS sandbox specification.
 */

var DEFAULT_DOMAIN = "https://lookmovie2.la";
var FALLBACK_TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
var DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * On Android TV, Nuvio's TV interface does not have a provider settings/gear icon.
 * For private builds (e.g. your private GitHub Secret Gist), you can optionally
 * fill in your credentials below so your Android TV automatically authenticates.
 * In public repositories, keep these strings empty ("").
 */
var TV_FALLBACK_CREDENTIALS = {
    email: "",      // e.g. "your_email@example.com"
    password: "",   // e.g. "your_password"
    cookie: ""      // e.g. "PHPSESSID=46ge6ted71ufjgqrb1smc4sab6" (bypasses login and CAPTCHAs)
};

/**
 * Normalizes mirror domain URL.
 */
function normalizeDomain(url) {
    if (!url || typeof url !== "string") return DEFAULT_DOMAIN;
    var d = url.trim();
    if (d.endsWith("/")) d = d.slice(0, -1);
    if (d.startsWith("http://")) d = "https://" + d.slice(7);
    if (d === "https://lookmovie2.to") {
        d = "https://www.lookmovie2.to";
    }
    return d;
}

/**
 * Extracts hostname from URL for compact UI badge display.
 */
function getHostName(url) {
    try {
        var m = String(url || "").match(/^https?:\/\/([^/?#]+)/i);
        if (m && m[1]) {
            return m[1].replace(/^www\./, "");
        }
        return url || "lookmovie";
    } catch (e) {
        return url || "lookmovie";
    }
}

/**
 * Masks email address for secure diagnostic logging in UI (e.g. u***3@example.com).
 */
function maskEmail(email) {
    if (!email || typeof email !== "string" || email.length < 4) return "****";
    var parts = email.split("@");
    if (parts.length === 2) {
        var u = parts[0];
        var d = parts[1];
        var masked = u.length > 2 ? u[0] + "***" + u[u.length - 1] : u[0] + "***";
        return masked + "@" + d;
    }
    return email[0] + "***" + email[email.length - 1];
}

/**
 * Creates a diagnostics tracker for the current scraper execution.
 */
function createDiagnosticState() {
    return {
        activeMirror: "",
        triedMirrors: [],
        authType: "none",            // "cookie" | "credentials" | "none"
        authStatus: "UNKNOWN",       // "SUCCESS" | "GUEST_NO_CREDS" | "BAD_CREDS" | "CAPTCHA" | "HTTP_ERROR" | "COOKIE_ACTIVE" | "NETWORK_ERROR"
        authMessage: "Checking status...",
        storageFound: false,
        qualitiesFound: []
    };
}

/**
 * Returns user-configured settings or defaults.
 * Falls back to TV_FALLBACK_CREDENTIALS for Android TV environments.
 */
function getSettings() {
    var s = (typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS) ? globalThis.SCRAPER_SETTINGS : {};
    var domain = (s.domain && typeof s.domain === "string" && s.domain.trim()) ? s.domain.trim() : DEFAULT_DOMAIN;
    domain = normalizeDomain(domain);

    var email = (s.email && typeof s.email === "string" && s.email.trim()) ? s.email.trim() : (TV_FALLBACK_CREDENTIALS.email || "");
    var password = (s.password && typeof s.password === "string" && s.password.trim()) ? s.password.trim() : (TV_FALLBACK_CREDENTIALS.password || "");
    var cookie = (s.cookie && typeof s.cookie === "string" && s.cookie.trim()) ? s.cookie.trim() : (TV_FALLBACK_CREDENTIALS.cookie || "");

    return {
        domain: domain,
        email: email,
        password: password,
        cookie: cookie,
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

// In-memory cache for authenticated session cookie
var sessionCache = {
    domain: "",
    email: "",
    cookie: "",
    timestamp: 0
};

/**
 * Authenticates with LookMovie account to unlock 1080p & 720p streams.
 * Records precise diagnostic status and reasons (bad credentials, CAPTCHA, etc.).
 */
function loginLookMovie(domain, email, password, customCookie, diag) {
    if (customCookie) {
        var cleanCookie = customCookie.replace(/^PHPSESSID=/, "").replace(/;$/, "").trim();
        if (cleanCookie) {
            console.log("[LookMovie2 Diagnostics] Using user-provided session cookie");
            if (diag) {
                diag.authType = "cookie";
                diag.authStatus = "COOKIE_ACTIVE";
                diag.authMessage = "Using custom session cookie (PHPSESSID)";
            }
            return Promise.resolve("PHPSESSID=" + cleanCookie + ";");
        }
    }

    if (!email || !password) {
        console.log("[LookMovie2 Diagnostics] No login credentials configured, continuing in Guest mode (480p SD only)");
        if (diag) {
            diag.authType = "none";
            diag.authStatus = "GUEST_NO_CREDS";
            diag.authMessage = "Guest Mode: No credentials configured (HD 1080p/720p locked by source)";
        }
        return Promise.resolve("");
    }

    if (diag) {
        diag.authType = "credentials";
    }
    domain = normalizeDomain(domain);

    // Reuse cached valid session (valid for 1 hour)
    var now = Date.now();
    if (sessionCache.cookie && sessionCache.domain === domain && sessionCache.email === email && (now - sessionCache.timestamp < 3600000)) {
        console.log("[LookMovie2 Diagnostics] Reusing active cached login session");
        if (diag) {
            diag.authStatus = "SUCCESS";
            diag.authMessage = "Logged In: Active session (" + maskEmail(email) + ")";
        }
        return Promise.resolve(sessionCache.cookie);
    }

    var loginUrl = domain + "/account/login";
    var headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": domain + "/",
        "Cache-Control": "no-cache"
    };

    console.log("[LookMovie2 Diagnostics] Initiating login handshake on " + domain + " for " + maskEmail(email));

    return fetch(loginUrl, { headers: headers }).then(function(res) {
        if (res.status === 403 || res.status === 503) {
            if (diag) {
                diag.authStatus = "HTTP_ERROR";
                diag.authMessage = "Login failed: HTTP " + res.status + " (Cloudflare block on " + domain + ")";
            }
            console.warn("[LookMovie2 Diagnostics] Login page blocked by Cloudflare (HTTP " + res.status + ")");
            return "";
        }

        var rawCookie = res.headers.get("set-cookie") || "";
        var sessMatch = rawCookie.match(/PHPSESSID=([^;,\s]+)/);
        var csrfCookieMatch = rawCookie.match(/_csrf=([^;,\s]+)/);

        var initialCookies = "";
        if (sessMatch) initialCookies += "PHPSESSID=" + sessMatch[1] + "; ";
        if (csrfCookieMatch) initialCookies += "_csrf=" + csrfCookieMatch[1] + "; ";

        return res.text().then(function(html) {
            var csrfTokenMatch = html.match(/name="_csrf"\s+value="([^"]+)"/) || html.match(/name="csrf-token"\s+content="([^"]+)"/);
            var csrf = csrfTokenMatch ? csrfTokenMatch[1] : "";
            if (!csrf) {
                console.warn("[LookMovie2 Diagnostics] CSRF token not found on " + domain + ", continuing as guest");
                if (diag) {
                    diag.authStatus = "NO_CSRF";
                    diag.authMessage = "Login failed: CSRF token not found on " + domain;
                }
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
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": loginUrl,
                    "Origin": domain,
                    "Cookie": initialCookies
                },
                body: postBody,
                redirect: "manual"
            }).then(function(postRes) {
                var postCookies = postRes.headers.get("set-cookie") || "";
                var postSessMatch = postCookies.match(/PHPSESSID=([^;,\s]+)/);
                var locationHeader = postRes.headers.get("location") || "";
                var finalUrl = postRes.url || "";
                var isLoginSuccess = false;

                var isRedirect = (postRes.status === 301 || postRes.status === 302 || postRes.status === 303);
                if (isRedirect && locationHeader && locationHeader.indexOf("/account/login") === -1) {
                    isLoginSuccess = true;
                } else if (!isRedirect && finalUrl && finalUrl.indexOf("/account/login") === -1 && (finalUrl.indexOf("/premium") !== -1 || finalUrl.endsWith("/"))) {
                    isLoginSuccess = true;
                }

                if (isLoginSuccess) {
                    var finalCookieId = postSessMatch ? postSessMatch[1] : (sessMatch ? sessMatch[1] : "");
                    if (finalCookieId) {
                        var authCookie = "PHPSESSID=" + finalCookieId + ";";
                        sessionCache = {
                            domain: domain,
                            email: email,
                            cookie: authCookie,
                            timestamp: Date.now()
                        };
                        console.log("[LookMovie2 Diagnostics] Login successful on " + domain + "! HD 1080p/720p unlocked");
                        if (diag) {
                            diag.authStatus = "SUCCESS";
                            diag.authMessage = "Logged In: HD unlocked (" + maskEmail(email) + ")";
                        }
                        return authCookie;
                    }
                }

                // Status 200 or unhandled redirect on /account/login is a failed login.
                // Analyze failure response HTML to provide exact diagnostics:
                return postRes.text().then(function(postHtml) {
                    var lowerHtml = postHtml.toLowerCase();
                    if (lowerHtml.indexOf("incorrect email or password") !== -1 || lowerHtml.indexOf("incorrect username or password") !== -1) {
                        console.warn("[LookMovie2 Diagnostics] Login failed: Incorrect email or password on " + domain);
                        if (diag) {
                            diag.authStatus = "BAD_CREDS";
                            diag.authMessage = "Login failed: Incorrect email or password";
                        }
                    } else if (lowerHtml.indexOf("recaptcha") !== -1 || lowerHtml.indexOf("g-recaptcha") !== -1 || lowerHtml.indexOf("captcha") !== -1) {
                        console.warn("[LookMovie2 Diagnostics] Login failed: reCAPTCHA bot challenge triggered on " + domain);
                        if (diag) {
                            diag.authStatus = "CAPTCHA";
                            diag.authMessage = "Login failed: reCAPTCHA challenge (Use browser PHPSESSID cookie to bypass)";
                        }
                    } else if (postRes.status === 403 || postRes.status === 429) {
                        console.warn("[LookMovie2 Diagnostics] Login failed: HTTP " + postRes.status + " rate limited or blocked");
                        if (diag) {
                            diag.authStatus = "HTTP_ERROR";
                            diag.authMessage = "Login failed: HTTP " + postRes.status + " (Rate limited/blocked)";
                        }
                    } else {
                        console.warn("[LookMovie2 Diagnostics] Login failed: Server returned HTTP " + postRes.status);
                        if (diag) {
                            diag.authStatus = "FAILED";
                            diag.authMessage = "Login failed: Server rejected request (Status " + postRes.status + ")";
                        }
                    }
                    return "";
                });
            });
        });
    }).catch(function(err) {
        console.warn("[LookMovie2 Diagnostics] Login network error on " + domain + ": " + (err.message || err));
        if (diag) {
            diag.authStatus = "NETWORK_ERROR";
            diag.authMessage = "Login network error: " + (err.message || err);
        }
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
            } else if (cleanCandidateTitle.indexOf(cleanTargetTitle) !== -1 || cleanTargetTitle.indexOf(cleanCandidateTitle) !== -1) {
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
 * Builds short diagnostic badge for stream title display (visible on Android TV Test Results).
 */
function buildShortBadge(mirrorHost, diag) {
    if (!diag) return "[" + mirrorHost + "]";
    switch (diag.authStatus) {
        case "SUCCESS":
            return "[" + mirrorHost + " | ✅ Logged In]";
        case "GUEST_NO_CREDS":
            return "[" + mirrorHost + " | ⚠️ Guest: No login]";
        case "BAD_CREDS":
            return "[" + mirrorHost + " | ❌ Login failed: Wrong password]";
        case "CAPTCHA":
            return "[" + mirrorHost + " | ❌ Login failed: reCAPTCHA]";
        case "COOKIE_ACTIVE":
            return "[" + mirrorHost + " | 🔑 Session Cookie]";
        case "HTTP_ERROR":
            return "[" + mirrorHost + " | ❌ Login failed: HTTP error]";
        case "NETWORK_ERROR":
            return "[" + mirrorHost + " | ❌ Login failed: Network error]";
        default:
            return "[" + mirrorHost + " | " + diag.authStatus + "]";
    }
}

/**
 * Calls LookMovie's access API endpoint to get direct stream URLs and subtitles.
 * Injects detailed diagnostic badges into stream.title and stream.name.
 */
function fetchAccessStreams(domain, storageData, seasonNum, episodeNum, sessionCookie, refererUrl, diag) {
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
            console.warn("[LookMovie2 Diagnostics] No streams returned by access API on " + domain, json);
            return [];
        }

        var streamsObj = json.streams;
        var subsArr = Array.isArray(json.subtitles) ? json.subtitles : [];

        // Format subtitles (handling string paths safely)
        var parsedSubtitles = [];
        for (var s = 0; s < subsArr.length; s++) {
            var sub = subsArr[s];
            if (sub && typeof sub.file === "string") {
                var subUrl = sub.file.startsWith("http") ? sub.file : domain + sub.file;
                var lang = sub.language || "Unknown";
                parsedSubtitles.push({
                    url: subUrl,
                    language: lang,
                    name: lang
                });
            }
        }

        // Normalize quality keys (e.g. "1080" and "1080p" -> "1080p")
        var rawKeys = Object.keys(streamsObj);
        var parsedQualities = [];
        for (var k = 0; k < rawKeys.length; k++) {
            var rawKey = rawKeys[k];
            var streamUrl = streamsObj[rawKey];
            if (!streamUrl || typeof streamUrl !== "string") continue;
            var normQual = rawKey.toLowerCase();
            if (!normQual.endsWith("p") && /^\d+$/.test(normQual)) {
                normQual = normQual + "p";
            }
            parsedQualities.push({
                rawKey: rawKey,
                normQual: normQual,
                url: streamUrl
            });
        }

        // Sort by quality priority (2160p -> 1080p -> 720p -> 480p)
        var qualityPriority = ["2160p", "1080p", "720p", "480p", "360p", "auto"];
        parsedQualities.sort(function(a, b) {
            var idxA = qualityPriority.indexOf(a.normQual);
            var idxB = qualityPriority.indexOf(b.normQual);
            if (idxA === -1) idxA = 99;
            if (idxB === -1) idxB = 99;
            return idxA - idxB;
        });

        var host = getHostName(domain);
        var badge = buildShortBadge(host, diag);
        var results = [];

        for (var q = 0; q < parsedQualities.length; q++) {
            var item = parsedQualities[q];
            var qualLabel = item.normQual.toUpperCase();
            var streamTitle = storageData.title || "LookMovie";
            if (storageData.year) {
                streamTitle += " (" + storageData.year + ")";
            }
            if (storageData.kind === "tv") {
                streamTitle += " S" + (seasonNum < 10 ? "0" + seasonNum : seasonNum) +
                               "E" + (episodeNum < 10 ? "0" + episodeNum : episodeNum);
            }

            // Append diagnostic indicator directly into stream.title for instant visibility in Nuvio
            var fullTitle = streamTitle + " • " + badge;
            var fullName = "LookMovie2 - " + qualLabel + " [Site: " + host + " • " + (diag ? diag.authMessage : "OK") + "]";

            results.push({
                name: fullName,
                title: fullTitle,
                url: item.url,
                quality: item.normQual,
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
 * Attempts scraping across candidate mirrors until streams are found.
 * If a mirror produces only guest (480p) streams due to login failure, continues trying
 * subsequent mirrors to find 1080p/720p, falling back to the guest streams if needed.
 */
function tryScrapeWithMirrors(mirrors, index, meta, seasonNum, episodeNum, settings, guestFallback, diag) {
    if (index >= mirrors.length) {
        if (guestFallback && guestFallback.length > 0) {
            console.log("[LookMovie2 Diagnostics] Returning guest fallback streams (no mirror returned HD)");
            return Promise.resolve(guestFallback);
        }
        console.warn("[LookMovie2 Diagnostics] All mirrors exhausted for:", meta.title);
        
        // Return a diagnostic fallback item so the user sees the exact failure cause in Nuvio Test Results
        var triedHosts = [];
        for (var t = 0; t < mirrors.length; t++) {
            triedHosts.push(getHostName(mirrors[t]));
        }
        var failHost = diag.activeMirror ? getHostName(diag.activeMirror) : triedHosts.join(", ");
        var failReason = diag.authMessage || "No streams found across candidate mirrors";

        return Promise.resolve([{
            title: "[Diagnostics] ❌ No streams • " + failHost,
            name: "LookMovie2: " + failReason + " (Tried: " + triedHosts.join(", ") + ")",
            quality: "ERROR",
            size: "N/A",
            url: "about:diagnostics",
            provider: "lookmovie2"
        }]);
    }

    var domain = normalizeDomain(mirrors[index]);
    if (!domain) {
        return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings, guestFallback, diag);
    }

    console.log("[LookMovie2 Diagnostics] Trying mirror (" + (index + 1) + "/" + mirrors.length + "): " + domain);
    diag.activeMirror = domain;
    diag.triedMirrors.push(domain);

    return loginLookMovie(domain, settings.email, settings.password, settings.cookie, diag).then(function(sessionCookie) {
        return searchLookMovie(domain, meta.title, meta.year, meta.mediaType, sessionCookie).then(function(candidate) {
            if (!candidate || !candidate.href) {
                if (meta.title && meta.title.toLowerCase().startsWith("the ")) {
                    var stripped = meta.title.slice(4).trim();
                    return searchLookMovie(domain, stripped, meta.year, meta.mediaType, sessionCookie);
                }
                return null;
            }
            return candidate;
        }).then(function(candidate) {
            if (!candidate || !candidate.href) {
                console.log("[LookMovie2 Diagnostics] No search match on mirror " + domain + " for " + meta.title);
                return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings, guestFallback, diag);
            }

            var playUrl = candidate.href
                .replace("/movies/view/", "/movies/play/")
                .replace("/shows/view/", "/shows/play/");

            console.log("[LookMovie2 Diagnostics] Fetching storage metadata from: " + playUrl);

            return extractStorageFromPage(playUrl, sessionCookie).then(function(storage) {
                diag.storageFound = true;
                return fetchAccessStreams(domain, storage, seasonNum, episodeNum, sessionCookie, playUrl, diag);
            }).then(function(streams) {
                if (streams && streams.length > 0) {
                    var hasHd = false;
                    for (var i = 0; i < streams.length; i++) {
                        if (streams[i].quality === "1080p" || streams[i].quality === "720p") {
                            hasHd = true;
                            break;
                        }
                    }

                    // If we have HD streams, return immediately
                    if (hasHd) return streams;

                    // If user has NO credentials configured, guest 480p is the maximum available on ANY mirror.
                    // Return immediately to avoid slow timeouts on fallback mirrors!
                    var hasUserCredentials = (settings.email && settings.password) || settings.cookie;
                    if (!hasUserCredentials) {
                        return streams;
                    }

                    // If credentials failed due to BAD_CREDS (wrong password confirmed by LookMovie server),
                    // all mirrors share the same account database. Return immediately with diagnostic failure badge:
                    if (diag && diag.authStatus === "BAD_CREDS") {
                        console.log("[LookMovie2 Diagnostics] Returning guest stream with bad credentials diagnostic");
                        return streams;
                    }

                    // If credentials were provided but mirror was blocked by CAPTCHA/Cloudflare,
                    // save as guest fallback and try subsequent mirrors for HD:
                    if (!guestFallback) guestFallback = streams;
                    return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings, guestFallback, diag);
                }
                return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings, guestFallback, diag);
            });
        });
    }).catch(function(err) {
        console.warn("[LookMovie2 Diagnostics] Mirror " + domain + " failed (" + (err.message || err) + "), trying next...");
        return tryScrapeWithMirrors(mirrors, index + 1, meta, seasonNum, episodeNum, settings, guestFallback, diag);
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
    var diag = createDiagnosticState();

    console.log("[LookMovie2 Diagnostics] Starting getStreams for media ID:", tmdbId, "type:", mediaType, "S:", seasonNum, "E:", episodeNum);
    console.log("[LookMovie2 Diagnostics] Active settings: domain=" + settings.domain + ", email=" + (settings.email ? maskEmail(settings.email) : "(none)") + ", cookie=" + (settings.cookie ? "provided" : "(none)"));

    return getTmdbMetadata(tmdbId, mediaType).then(function(meta) {
        if (!meta.title) {
            console.error("[LookMovie2 Diagnostics] Could not resolve title from media ID:", tmdbId);
            return [{
                title: "[Diagnostics] ❌ TMDB title lookup failed for ID " + tmdbId,
                name: "LookMovie2: Could not resolve title from TMDB API",
                quality: "ERROR",
                size: "N/A",
                url: "about:diagnostics",
                provider: "lookmovie2"
            }];
        }

        console.log("[LookMovie2 Diagnostics] Resolved media title: \"" + meta.title + "\" (" + meta.year + ")");

        // Prioritized list of responsive mirrors
        var mirrorList = [];
        var configuredDomain = normalizeDomain(settings.domain);
        mirrorList.push(configuredDomain);

        var candidateMirrors = [
            "https://lookmovie2.la",
            "https://www.lookmovie2.to",
            "https://lookmovie.ag",
            "https://lookmovie.foundation",
            "https://lookmovie.io"
        ];
        for (var m = 0; m < candidateMirrors.length; m++) {
            var norm = normalizeDomain(candidateMirrors[m]);
            if (mirrorList.indexOf(norm) === -1) {
                mirrorList.push(norm);
            }
        }

        return tryScrapeWithMirrors(mirrorList, 0, meta, seasonNum, episodeNum, settings, null, diag);
    }).catch(function(err) {
        console.error("[LookMovie2 Diagnostics] Scraper error:", err && err.message ? err.message : err);
        return [{
            title: "[Diagnostics] ❌ Scraper error: " + (err && err.message ? err.message : err),
            name: "LookMovie2 Error: " + (err && err.message ? err.message : err),
            quality: "ERROR",
            size: "N/A",
            url: "about:diagnostics",
            provider: "lookmovie2"
        }];
    });
}

/**
 * Defines settings layout for Nuvio settings modal (desktop / mobile).
 */
function onSettings() {
    return Promise.resolve([
        {
            type: "header",
            label: "LookMovie2 Settings"
        },
        {
            type: "info",
            label: "Configure your LookMovie2 domain or proxy mirror and account credentials. Authenticating unlocks 1080p and 720p HD streams."
        },
        {
            type: "text",
            key: "domain",
            label: "LookMovie Domain",
            placeholder: "https://lookmovie2.la",
            description: "Active LookMovie domain or mirror (default: https://lookmovie2.la)"
        },
        {
            type: "text",
            key: "email",
            label: "Account Email / Username",
            placeholder: "user@example.com",
            description: "Your LookMovie login to unlock 1080p & 720p HD streams"
        },
        {
            type: "text",
            key: "password",
            label: "Account Password",
            isPassword: true,
            placeholder: "••••••••",
            description: "Your LookMovie password"
        },
        {
            type: "text",
            key: "cookie",
            label: "Session Cookie (PHPSESSID)",
            placeholder: "e.g. 46ge6ted71ufjgqrb1smc4sab6",
            description: "Optional: Paste your LookMovie PHPSESSID cookie to bypass login forms and CAPTCHAs completely"
        },
        {
            type: "select",
            key: "preferredQuality",
            label: "Quality Selection",
            options: [
                { label: "All Qualities", value: "All" },
                { label: "1080p Full HD", value: "1080p" },
                { label: "720p HD", value: "720p" },
                { label: "480p SD", value: "480p" }
            ],
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
