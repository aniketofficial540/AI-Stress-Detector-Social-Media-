// --- 1. LOAD ENVIRONMENT VARIABLES ---
// Must be at the VERY TOP
import 'dotenv/config';

import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import axios from 'axios';
import { profile } from "console"; // (You might not need this 'profile' import)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 2. READ SECRETS FROM process.env ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const sessionSecret = process.env.SESSION_SECRET;
const flaskServerUrl = process.env.FLASK_SERVER_URL;

// Check if secrets are loaded
if (!supabaseUrl || !supabaseKey || !sessionSecret || !flaskServerUrl) {
    console.error("Error: Missing environment variables. Please check your .env file or Render settings.");
    process.exit(1); // Stop the server if keys are missing
}

const supabase = createClient(supabaseUrl, supabaseKey);
const app = express();
// Make sure you define port AFTER reading env vars, in case you want to use process.env.PORT later
const port = process.env.PORT || 5500; // Use Render's port or default to 5500

app.use(express.json());

app.set("view engine", "ejs");
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
// Remove '/uploads' static route if you are not using it anymore
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(bodyParser.urlencoded({ extended: true }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production'
    }
}));


// --- Routes ---

app.get("/", (req, res) => {
    res.render("login.ejs");
});

app.get("/signup", (req, res) => {
    res.render("signup.ejs");
});

app.post("/signup", async (req, res) => {
    const { username, password, email } = req.body;

    if (!username || !password || !email) {
        return res.status(400).send("Email, Username and Password are required");
    }

    try {
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    username: username
                }
            }
        });

        if (error) {
            console.error("Supabase signup error:", error.message);
            return res.status(400).send(`
                <script>
                    alert("Signup failed: ${error.message.replace(/"/g, '\\"')}"); // Escape quotes for JS alert
                    window.location.href = "/signup";
                </script>
            `);
        }

        console.log("User registered successfully:", data.user?.id); // Use optional chaining

        return res.send(`
            <script>
                alert("Signup successful! Please check your email to confirm.");
                window.location.href = "/login";
            </script>
        `);

    } catch (err) {
        console.error("Server error during signup:", err);
        return res.status(500).send("Internal Server Error");
    }
});


app.get("/login", (req, res) => {
    res.render("login.ejs");
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).send("Email and Password are required");
    }

    console.log("Attempting login with email:", email);

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            console.error("Supabase login error:", error.message);
            return res.status(401).send("Invalid email or password.");
        }

        console.log("Login successful!", data.user.id);

        req.session.user = data.user;
        req.session.access_token = data.session.access_token;

        const { data: profileData, error: profileError } = await supabase // Renamed variable
            .from('profiles')
            .select('username')
            .eq('id', data.user.id)
            .single();

        if (profileError || !profileData) {
            console.error("Could not find profile for user:", data.user.id, profileError?.message);
            // Destroy session if profile lookup fails? Might be safer.
            req.session.destroy(() => {});
            return res.status(500).send("Login failed: Could not find user profile data.");
        }

        req.session.username = profileData.username;

        req.session.save((err) => { // Handle potential save error
             if (err) {
                 console.error("Session save error:", err);
                 return res.status(500).send("Internal Server Error");
             }
            res.redirect(`/profile/${profileData.username}`);
        });

    } catch (err) {
        console.error("Server error during login:", err);
        return res.status(500).send("Internal Server Error");
    }
});

app.get("/profile/:username", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }
    const { username } = req.params;

    try {
        const { data: profileData, error } = await supabase
            .from('profiles')
            .select(`
                username, display_name, bio, profile_image_url,
                posts ( id, caption, image_url, created_at, stress_level )
            `)
            .eq('username', username)
            .order('created_at', { referencedTable: 'posts', ascending: false })
            .maybeSingle(); // Use maybeSingle() - returns null instead of error if not found

        if (error) {
            console.error("Error fetching profile:", error.message);
            return res.status(500).send("Internal Server Error");
        }

        if (!profileData) {
            return res.status(404).send("User not found");
        }

        res.render("profile.ejs", {
            username: profileData.username,
            displayName: profileData.display_name || "", // Default to empty string
            bio: profileData.bio || "",
            profileImage: profileData.profile_image_url || "/default-avatar.png", // Keep default avatar path relative if served locally
            posts: profileData.posts.map(post => ({
                image: post.image_url,
                caption: post.caption,
                timestamp: post.created_at
            }))
        });

    } catch (err) {
        console.error("Server error fetching profile:", err);
        return res.status(500).send("Internal Server Error");
    }
});

app.get("/create-post", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    try {
        const userId = req.session.user.id;
        const username = req.session.username;

        const { data: profileData, error } = await supabase // Renamed variable
            .from('profiles')
            .select('profile_image_url')
            .eq('id', userId)
            .single();

        if (error || !profileData) {
            console.error("Error fetching profile for create-post:", error?.message);
            // Don't necessarily kill the page, maybe just use default image?
             res.render("create-post.ejs", {
                username: username || "User", // Fallback username
                profileImage: "/default-avatar.png"
            });
            return;
            // return res.status(500).send("Internal Server Error fetching profile");
        }

        res.render("create-post.ejs", {
            username: username || "User",
            profileImage: profileData.profile_image_url || "/default-avatar.png"
        });

    } catch (err) {
        console.error("Server error getting create-post page:", err);
        return res.status(500).send("Internal Server Error");
    }
});

app.post("/create-post", upload.single("image"), async (req, res) => {
    if (!req.session.user || !req.session.access_token) { // Check token too
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
        const userId = req.session.user.id;
        const accessToken = req.session.access_token;
        const username = req.session.username;

        // Create user-specific client only if needed (e.g., for storage uploads)
        const userSupabase = createClient(supabaseUrl, supabaseKey, {
            global: {
                headers: { Authorization: `Bearer ${accessToken}` }
            }
        });

        const { caption } = req.body;
        const file = req.file;
        let imageUrl = null;

        if (file) {
            const fileName = `${userId}/${Date.now()}-${file.originalname}`;

            const { error: uploadError } = await userSupabase.storage
                .from('post_images')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype
                });

            if (uploadError) {
                console.error("Supabase post upload error:", uploadError.message);
                return res.status(500).json({ success: false, message: "Could not upload image." });
            }

            const { data: urlData } = userSupabase.storage
                .from('post_images')
                .getPublicUrl(fileName);

            imageUrl = urlData.publicUrl;
        }

        // Use userSupabase for insert too, respects RLS if added later
        const { error: insertError } = await userSupabase
            .from('posts')
            .insert({
                user_id: userId,
                caption: caption || "", // Ensure caption is not null
                image_url: imageUrl
            });

        if (insertError) {
            console.error("Error inserting post data:", insertError.message);
            return res.status(500).json({ success: false, message: "Database Error" });
        }

        console.log("Post created successfully!");
        res.json({ success: true, username: username });

    } catch (err) {
        console.error("Server error creating post:", err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

app.get("/edit-profile", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    const userId = req.session.user.id;

    try {
        const { data: profileData, error } = await supabase // Renamed variable
            .from('profiles')
            .select('username, display_name, bio, profile_image_url')
            .eq('id', userId)
            .single();

        if (error) {
            console.error("Error fetching profile for editing:", error.message);
            return res.status(500).send("Internal Server Error");
        }

        // Pass the profile data object directly
        res.render("edit-profile.ejs", { profile: profileData });

    } catch (err) {
        console.error("Server error getting edit-profile page:", err);
        return res.status(500).send("Internal Server Error");
    }
});

app.post("/edit-profile", upload.single('profile_image'), async (req, res) => {
    if (!req.session.user || !req.session.access_token) { // Check token
         return res.status(401).send("Unauthorized");
    }

    try {
        const userId = req.session.user.id;
        const accessToken = req.session.access_token;

        console.log("Access Token being used for profile update/upload:", accessToken ? "Present" : "MISSING");

        if (!accessToken) {
            return res.status(401).send("Auth error: No access token found in session.");
        }

        const userSupabase = createClient(supabaseUrl, supabaseKey, {
            global: {
                headers: { Authorization: `Bearer ${accessToken}` }
            }
        });

        const { display_name, bio } = req.body;
        const file = req.file;

        const updates = {
            display_name: display_name || "", // Default to empty strings if null
            bio: bio || "",
        };

        if (file) {
            // Use user ID + timestamp for uniqueness, avatar can overwrite
            const fileName = `${userId}/avatar-${Date.now()}`;

            const { error: uploadError } = await userSupabase.storage
                .from('profile_images')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype,
                    upsert: true // Overwrite existing avatar
                });

            if (uploadError) {
                console.error("Supabase avatar upload error:", uploadError.message);
                return res.status(500).send("Could not upload new profile image.");
            }

            const { data: urlData } = userSupabase.storage
                .from('profile_images')
                .getPublicUrl(fileName);

            updates.profile_image_url = urlData.publicUrl;
        }

        const { error: updateError } = await userSupabase
            .from('profiles')
            .update(updates)
            .eq('id', userId);

        if (updateError) {
            console.error("Error updating profile:", updateError.message);
            return res.status(500).send("Database error while updating profile.");
        }

        console.log("Profile updated successfully for user:", userId);
        res.redirect(`/profile/${req.session.username}`); // Redirect back to profile

    } catch (err) {
        console.error("Server error updating profile:", err);
        return res.status(500).send("Internal Server Error");
    }
});

// --- THIS IS THE UPDATED /home ROUTE ---
app.get("/home", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    const userId = req.session.user.id;
    let aiTriggeredSuccessfully = false; // Flag to track AI server response

    try {
        // --- MODIFIED AI TRIGGER ---
        console.log(`Attempting to trigger AI server at: ${flaskServerUrl}/home`);
        try {
            // Wait for max 7 seconds (7000 ms) for the Python server
            const aiResponse = await axios.get(flaskServerUrl + "/home", { timeout: 7000 });
            // If we get here, the server responded within the timeout
            console.log("Flask model trigger successful:", aiResponse.data);
            aiTriggeredSuccessfully = true;
        } catch (err) {
            if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') { // More specific check
                // This means it timed out (server was likely asleep)
                console.warn("Flask trigger timed out (server likely asleep, but waking up now).");
                // aiTriggeredSuccessfully remains false
            } else {
                // Other errors (like 502, wrong URL, etc.)
                console.error("Flask trigger error:", err.message);
                // aiTriggeredSuccessfully remains false
            }
            // --- IMPORTANT: We DON'T stop the page load if the AI fails ---
        }

        // --- Fetch posts and profile (same as before) ---
        const postsQuery = supabase
            .from('posts')
            .select(`
                caption, image_url, created_at, stress_level,
                profiles (username, display_name, profile_image_url)
            `)
            .order('created_at', { ascending: false });

        const profileQuery = supabase
            .from('profiles')
            .select('username, display_name, profile_image_url, bio')
            .eq('id', userId)
            .single();

        const [postsResult, profileResult] = await Promise.all([
            postsQuery,
            profileQuery
        ]);

        // Error checking
        if (postsResult.error) {
            console.error("Error fetching posts:", postsResult.error.message);
            return res.status(500).send("Error fetching posts");
        }
        if (profileResult.error) {
            console.error("Error fetching user profile:", profileResult.error.message);
            // Maybe don't fail completely? Render page with default profile?
            return res.status(500).send("Error fetching user profile");
        }

        // Mapping data
        const mappedPosts = postsResult.data.map(post => ({
            caption: post.caption,
            image: post.image_url,
            timestamp: post.created_at,
            stress_level: post.stress_level,
            // Check if profiles object exists before accessing its properties
            display_name: post.profiles?.display_name || "User",
            profile_image: post.profiles?.profile_image_url || "/default-avatar.png",
            username: post.profiles?.username || "unknown"
        }));


        // --- Render the page, passing the flag ---
        res.render("home.ejs", {
            posts: mappedPosts,
            user: req.session.user,
            profile: profileResult.data,
            showAiMessage: !aiTriggeredSuccessfully // Pass true if AI timed out/failed
        });

    } catch (err) {
        console.error("Server error in /home route:", err);
        return res.status(500).send("Internal Server Error");
    }
});
// --- END OF UPDATED /home ROUTE ---


app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send("Could not log out.");
        }
        res.redirect("/login");
    });
});


app.listen(port, () => {
    console.log(`Node.js server is running on port ${port}`);
});

