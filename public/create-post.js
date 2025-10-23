document.addEventListener('DOMContentLoaded', function () {
    const elements = {
        backButton: document.getElementById('back-button'),
        shareButton: document.getElementById('share-button'),
        postImageInput: document.getElementById('post-image'),
        imagePreview: document.getElementById('image-preview'),
        postCaption: document.getElementById('post-caption'),
        selectImageBtn: document.getElementById('select-image-btn'),
        step1: document.getElementById('step-1'),
        step2: document.getElementById('step-2'),
        // ✅ Get the form element
        form: document.getElementById('post-form') 
    };

    let currentStep = 1;
    let selectedFile = null;

    elements.backButton.addEventListener('click', goBack);
    
    // ❌ REMOVE THIS LINE:
    // elements.shareButton.addEventListener('click', sharePost);
    
    // ✅ ADD THIS LINE: Listen for the 'submit' event on the FORM, not a 'click' on the button.
    elements.form.addEventListener('submit', sharePost);

    elements.selectImageBtn.addEventListener('click', () => elements.postImageInput.click());
    elements.postImageInput.addEventListener('change', handleImageUpload);
    elements.postCaption.addEventListener('input', updateShareButtonState);

    function goBack() {
        if (currentStep === 1) {
            window.history.back();
        } else {
            showStep(1);
        }
    }

    function handleImageUpload(e) {
        if (e.target.files && e.target.files[0]) {
            selectedFile = e.target.files[0];
            const reader = new FileReader();

            reader.onload = function (event) {
                elements.imagePreview.src = event.target.result;
                showStep(2);
                updateShareButtonState();
            };

            reader.readAsDataURL(selectedFile);
        } else {
            selectedFile = null;
            updateShareButtonState();
        }
    }

    function showStep(step) {
        currentStep = step;
        elements.step1.style.display = step === 1 ? 'flex' : 'none';
        elements.step2.style.display = step === 2 ? 'flex' : 'none';
    }

    function updateShareButtonState() {
        const hasCaption = elements.postCaption.value.trim() !== '';
        const hasImage = selectedFile !== null;
        elements.shareButton.disabled = !hasCaption && !hasImage;
    }
    
    async function sharePost(e) {
        // This will now correctly prevent the default form submission
        e.preventDefault(); 

        elements.shareButton.disabled = true;
        elements.shareButton.textContent = 'Sharing...';

        const formData = new FormData();
        
        // Now it will correctly get the caption text
        formData.append("caption", elements.postCaption.value); 

        if (selectedFile) {
            formData.append("image", selectedFile);
        }

        try {
            const response = await fetch("/create-post", {
                method: "POST",
                body: formData
            });

            const data = await response.json(); 

            if (response.ok) { 
                // This code will now run, redirecting you
                window.location.href = `/profile/${data.username}`;
            } else {
                alert(`Error: ${data.message || 'Could not upload post.'}`);
                elements.shareButton.disabled = false;
                elements.shareButton.textContent = 'Share';
            }
        } catch (error) {
            console.error("Upload failed:", error);
            alert("Something went wrong!");
            elements.shareButton.disabled = false;
            elements.shareButton.textContent = 'Share';
        }
    }
});
