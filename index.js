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
import { profile } from "console";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 2. READ SECRETS FROM process.env ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const sessionSecret = process.env.SESSION_SECRET;

// Check if secrets are loaded
if (!supabaseUrl || !supabaseKey || !sessionSecret) {
    console.error("Error: Missing environment variables. Please check your .env file.");
    process.exit(1); // Stop the server if keys are missing
}

const supabase = createClient(supabaseUrl, supabaseKey);
const app = express();
const port = 5500;

app.use(express.json());

app.set("view engine", "ejs");
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(bodyParser.urlencoded({ extended: true }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const flaskServerUrl = process.env.FLASK_SERVER_URL;

app.use(session({
    // --- 3. USE YOUR SECRET FROM .env ---
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { 
        // --- 4. PRODUCTION SETTING ---
        // Set this to 'true' when you deploy to a site with HTTPS
        secure: process.env.NODE_ENV === 'production' 
    }
}));


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
                    alert("Signup failed: ${error.message}");
                    window.location.href = "/signup";
                </script>
            `);
        }

        console.log("User registered successfully:", data.user.id);
        
        return res.send(`
            <script>
                alert("Signup successful! Please check your email to confirm.");
                window.location.href = "/login";
            </script>
        `);

    } catch (err) {
        console.error("Server error:", err);
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

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', data.user.id)
            .single();

        if (profileError || !profile) {
            console.error("Could not find profile for user:", data.user.id);
            return res.status(500).send("Login failed: Could not find user profile.");
        }

        req.session.username = profile.username;

        req.session.save(() => {
            res.redirect(`/profile/${profile.username}`);
        });

    } catch (err) {
        console.error("Server error:", err);
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
                username,
                display_name,
                bio,
                profile_image_url,
                posts (
                    id,
                    caption,
                    image_url,
                    created_at,
                    stress_level
                )
            `)
            .eq('username', username)
            .order('created_at', { referencedTable: 'posts', ascending: false })
            .single(); 

        if (error) {
            console.error("Error fetching profile:", error.message);
            return res.status(500).send("Internal Server Error");
        }

        if (!profileData) {
            return res.status(404).send("User not found");
        }

        res.render("profile.ejs", {
            username: profileData.username,
            displayName: profileData.display_name || "Your Name",
            bio: profileData.bio || "This is my bio where I can write something about myself.",
            profileImage: profileData.profile_image_url || "/default-avatar.png",
            
            posts: profileData.posts.map(post => ({
                image: post.image_url,
                caption: post.caption,
                timestamp: post.created_at
            }))
        });

    } catch (err) {
        console.error("Server error:", err);
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

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('profile_image_url')
            .eq('id', userId)
            .single();

        if (error || !profile) {
            console.error("Error fetching profile for create-post:", error);
            return res.status(500).send("Internal Server Error");
        }

        res.render("create-post.ejs", {
            username: username,
            profileImage: profile.profile_image_url || "/default-avatar.png"
        });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).send("Internal Server Error");
    }
});

app.post("/create-post", upload.single("image"), async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login"); 
    }

    try {
        const userId = req.session.user.id;
        const accessToken = req.session.access_token;
        const username = req.session.username;

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

        const { error: insertError } = await userSupabase
            .from('posts')
            .insert({
                user_id: userId,
                caption: caption,
                image_url: imageUrl
            });

        if (insertError) {
            console.error("Error inserting post data:", insertError.message);
            return res.status(500).json({ success: false, message: "Database Error" });
        }

        console.log("Post created successfully!");
        res.json({ success: true, username: username }); 

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

app.get("/edit-profile", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    const userId = req.session.user.id;

    try {
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('username, display_name, bio, profile_image_url')
            .eq('id', userId)
            .single();

        if (error) {
            console.error("Error fetching profile for editing:", error.message);
            return res.status(500).send("Internal Server Error");
        }

        res.render("edit-profile.ejs", { profile });

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).send("Internal Server Error");
    }
});

app.post("/edit-profile", upload.single('profile_image'), async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    try {
        const userId = req.session.user.id;
        const accessToken = req.session.access_token;

        console.log("Access Token being used for upload:", accessToken);

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
            display_name: display_name,
            bio: bio,
        };

        if (file) {
            const fileName = `${userId}/avatar-${Date.now()}`;

            const { error: uploadError } = await userSupabase.storage
                .from('profile_images')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype,
                    upsert: true
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

        res.redirect(`/profile/${req.session.username}`);

    } catch (err) {
        console.error("Server error:", err);
        return res.status(500).send("Internal Server Error");
    }
});

app.get("/home", async (req, res) => {

    // 1. Check for logged-in user (same as before)
    if (!req.session.user) {
        return res.redirect("/login");
    }

    const userId = req.session.user.id;

    // 2. Trigger the AI Flask server (same as before)
    // ✅ *** THIS IS THE FIX ***
    // We are now using the variable from your .env file
    axios.get(flaskServerUrl + "/home") // Replaced "http://localhost:5000/home"
        .then(() => console.log("Flask model trigger successful."))
        .catch(err => console.error("Flask trigger error:", err.message));

    try {
        // 3. We have two queries to run:
        //    a) Get all posts AND their authors' profile info
        //    b) Get the logged-in user's profile info for the sidebar

        const postsQuery = supabase
            .from('posts')
            .select(`
                caption,
                image_url,
                created_at,
                stress_level,
                profiles (
                    username,
                    display_name,
                    profile_image_url
                )
            `)
            .order('created_at', { ascending: false });

        const profileQuery = supabase
            .from('profiles')
            .select('username, display_name, profile_image_url, bio')
            .eq('id', userId)
            .single();
        
        // 4. Run both queries at the same time for speed
        const [postsResult, profileResult] = await Promise.all([
            postsQuery,
            profileQuery
        ]);

        // 5. Check for errors from either query
        if (postsResult.error) {
            console.error("Error fetching posts:", postsResult.error.message);
            return res.status(500).send("Error fetching posts");
        }
        if (profileResult.error) {
            console.error("Error fetching user profile:", profileResult.error.message);
            return res.status(500).send("Error fetching user profile");
        }

        // 6. Map the data to be EJS-friendly
        const mappedPosts = postsResult.data.map(post => ({
            // Post details
            caption: post.caption,
            image: post.image_url,
            timestamp: post.created_at,
            stress_level: post.stress_level, 
            
            // Author's details (flattened from 'post.profiles')
            display_name: post.profiles.display_name,
            profile_image: post.profiles.profile_image_url,
            username: post.profiles.username
        }));

        // 7. Render the page
        res.render("home.ejs", {
            posts: mappedPosts,
            user: req.session.user, // Fixed the typo here too (was session..user)
            profile: profileResult.data, 
        });

    } catch (err) {
        console.error("Server error in /home:", err.message);
        return res.status(500).send("Internal Server Error");
    }
});

// Add this route to your main server file
app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send("Could not log out.");
        }
        // Redirect to the login page after session is destroyed
        res.redirect("/login");
    });
});


app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})
