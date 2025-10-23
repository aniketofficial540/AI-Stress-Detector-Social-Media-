# --- 1. LOAD ENVIRONMENT VARIABLES ---
from dotenv import load_dotenv
load_dotenv() # This loads the .env file

from flask import Flask
from supabase import create_client, Client
import joblib 
import re
import os # Import os to read environment variables

try:
    # Load your ML model and vectorizer
    model = joblib.load('Datasets/stress_model.joblib')
    vectorizer = joblib.load('Datasets/tfidf_vectorizer.joblib')
    print("Scikit-learn model and vectorizer loaded successfully!")
except FileNotFoundError:
    print("Error: Model or vectorizer file not found. Make sure files are in the 'Datasets' folder.")
    exit()

app = Flask(__name__)

# --- 2. READ SECRETS FROM ENVIRONMENT ---
# These are loaded from your .env file
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") # Use the SERVICE key for admin rights

# Check if secrets are loaded
if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Please check .env file.")
    exit()

# Initialize the Supabase admin client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- 3. HELPER FUNCTIONS ---
def clean_text(text):
    """Cleans text for the ML model."""
    if not isinstance(text, str):
        return ""
    text = re.sub(r'[^a-zA-Z0-9\s]', '', text.lower())
    return text.strip()

def predict_stress(text):
    """Analyzes text and returns a numeric stress level."""
    text_vectorized = vectorizer.transform([text])
    # model.predict() returns [1] or [0]
    prediction = model.predict(text_vectorized) 
    
    # Return 1.00 or 0.00 to match our 'numeric' database column
    return 1.00 if prediction[0] == 1 else 0.00


# --- 4. THE MAIN AI ROUTE ---
@app.route('/home', methods=['GET'])
def update_stress_status():
    """Triggered by the Node.js server to analyze new posts."""
    print("\n--- AI Server Triggered ---")
    try:
        # Get all posts where 'stress_level' is still NULL
        response = supabase.table('posts').select('id, caption').filter('stress_level', 'is', 'null').execute()

        posts = response.data
        if not posts:
            print("Flask: No new posts to process.")
            return "No new posts to process. All caught up! ✅"

        print(f"Flask: Found {len(posts)} new post(s) to analyze.")
        processed_count = 0
        for post in posts:
            post_id = post['id']
            caption = post['caption']
            
            clean_caption = clean_text(caption)
            if not clean_caption:
                print(f"Flask: Post {post_id} had no text. Skipping.")
                continue

            # This will be 1.00 or 0.00
            label = predict_stress(clean_caption) 
            print(f"Flask: Post {post_id} analyzed. Result: {label}")

            # Update the 'stress_level' column with the numeric label
            # This works because we are using the SERVICE_KEY
            supabase.table('posts').update({'stress_level': label}).eq('id', post_id).execute()
            
            processed_count += 1
        
        print(f"Flask: Successfully processed {processed_count} post(s).")
        return f"{processed_count} post(s) processed and updated successfully."

    except Exception as e:
        print(f"Flask Error: {str(e)}")
        return f"An unexpected error occurred: {str(e)}"

if __name__ == '__main__':
    # --- 5. PRODUCTION SETTING ---
    # Set debug=False for deployment
    app.run(debug=False, port=5000)

