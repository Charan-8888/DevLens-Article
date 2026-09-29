document.addEventListener("DOMContentLoaded", () => {
    const articleContainer = document.getElementById("article-content");
    const tocContainer = document.getElementById("toc");
    const loadingState = document.getElementById("loading");
    const progressBar = document.getElementById("progressBar");

    // Scroll Progress Bar
    window.addEventListener("scroll", () => {
        const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
        const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = (winScroll / height) * 100;
        progressBar.style.width = scrolled + "%";
    });

    // Configure Marked to include IDs in headings for TOC linking
    const renderer = new marked.Renderer();
    renderer.heading = function (text, level) {
        const escapedText = text.toLowerCase().replace(/[^\w]+/g, '-');
        return `
            <h${level} id="${escapedText}">
                ${text}
            </h${level}>`;
    };
    marked.setOptions({
        renderer: renderer,
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true
    });

    // Fetch the markdown article
    fetch('./artical.md')
        .then(response => {
            if (!response.ok) {
                throw new Error("Failed to load article.");
            }
            return response.text();
        })
        .then(markdown => {
            // Render markdown to HTML
            const html = marked.parse(markdown);
            articleContainer.innerHTML = html;

            // Hide loading, show content
            loadingState.style.display = 'none';
            articleContainer.style.display = 'block';
        })
        .catch(error => {
            console.error("Error fetching markdown:", error);
            loadingState.innerHTML = `<p style="color: #ef4444;">Error loading the article. Ensure 'artical.md' is in the same directory.</p>`;
        });

});
