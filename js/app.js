// ============================================================
// State
// ============================================================
let currentStep = 1;
const totalSteps = 8;
let jobCounter = 0;
let eduCounter = 0;
let projectCounter = 0;
let awardCounter = 0;
let publicationCounter = 0;
let customSectionCounter = 0;
let lastResumeData = null; // Stores the data used to render the current preview
let lastYamlSource = null; // Tracks where preview came from: 'wizard', 'editor', 'ai'
let originalYamlForDiff = null; // Base YAML before AI modification
let diffMode = false;            // Whether diff view is active
let rediffTimeout = null;        // Debounce timer for re-diffing on edit
let sectionOrder = null;              // Custom section ordering for drag-and-drop
let pageLayoutMode = 'auto';         // 'auto' | 'manual'
let targetPageCount = null;          // null = auto, or 1/2/3
let sectionPageAssignments = {};     // { sectionId: pageNumber }
let resizeTimeout = null;            // Debounce timer for resize handler
let computedPageAssignments = {};    // { sectionId: pageNumber } — result of last pagination
let textShrinkPercent = 100;         // 50-100, text scale percentage

const DEFAULT_SECTION_DEFS = [
    { id: 'rp-work-section', entryClass: 'rp-job', label: 'Work Experience' },
    { id: 'rp-education-section', entryClass: 'rp-education', label: 'Education' },
    { id: 'rp-projects-section', entryClass: 'rp-project', label: 'Projects' },
    { id: 'rp-awards-section', entryClass: 'rp-award', label: 'Awards' },
    { id: 'rp-publications-section', entryClass: 'rp-publication', label: 'Publications' },
    { id: 'rp-custom-sections-container', entryClass: 'rp-custom-section', isCustom: true, label: 'Custom Sections' },
    { id: 'rp-skills-section', entryClass: null, label: 'Skills' },
];

// ============================================================
// View Navigation
// ============================================================
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
    window.scrollTo(0, 0);
}

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    addJobEntry();
    addEducationEntry();
    addProjectEntry();
    addAwardEntry();
    addPublicationEntry();

    // Wizard navigation
    document.getElementById('next-btn').addEventListener('click', nextStep);
    document.getElementById('prev-btn').addEventListener('click', prevStep);
    document.getElementById('add-job').addEventListener('click', () => addJobEntry());
    document.getElementById('add-education').addEventListener('click', () => addEducationEntry());
    document.getElementById('add-project').addEventListener('click', () => addProjectEntry());
    document.getElementById('add-award').addEventListener('click', () => addAwardEntry());
    document.getElementById('add-publication').addEventListener('click', () => addPublicationEntry());
    document.getElementById('add-custom-section').addEventListener('click', () => addCustomSectionEntry());
    document.getElementById('load-example-btn').addEventListener('click', loadExample);
    document.getElementById('home-from-wizard-btn').addEventListener('click', () => showView('home-view'));

    // Home view path cards
    document.getElementById('path-upload').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });
    document.getElementById('path-wizard').addEventListener('click', () => {
        showView('wizard-view');
    });
    document.getElementById('path-ai').addEventListener('click', () => {
        showView('ai-view');
    });

    // Home drop zone
    setupDropZone('drop-zone', 'file-input', handleYamlFile);

    // AI view drop zone
    setupDropZone('ai-drop-zone', 'ai-file-input', handleAiYamlFile);

    // Preview actions
    document.getElementById('download-pdf-btn').addEventListener('click', downloadPDF);
    document.getElementById('print-btn').addEventListener('click', printResume);
    document.getElementById('edit-yaml-btn').addEventListener('click', () => {
        if (lastResumeData) {
            const currentYaml = dataToYaml(lastResumeData);
            if (originalYamlForDiff && lastYamlSource === 'ai') {
                showView('editor-view');
                enterDiffMode(originalYamlForDiff, currentYaml);
                return;
            }
            document.getElementById('yaml-editor').value = currentYaml;
            lastYamlSource = 'editor';
        }
        showView('editor-view');
    });
    document.getElementById('start-over-btn').addEventListener('click', () => {
        sectionOrder = null;
        pageLayoutMode = 'auto';
        targetPageCount = null;
        sectionPageAssignments = {};
        computedPageAssignments = {};
        textShrinkPercent = 100;
        document.documentElement.style.setProperty('--text-scale', '1');
        const sidebar = document.querySelector('.section-sidebar');
        if (sidebar) sidebar.remove();
        const previewContainer = document.querySelector('.preview-container');
        if (previewContainer) previewContainer.classList.remove('has-sidebar');
        const mobileSheet = document.getElementById('mobile-reorder-sheet');
        if (mobileSheet) mobileSheet.classList.remove('expanded');
        showView('home-view');
    });

    // Editor actions
    document.getElementById('editor-back-btn').addEventListener('click', () => {
        if (diffMode) exitDiffMode(document.getElementById('diff-right-editor').value);
        showView('home-view');
    });
    document.getElementById('save-yaml-btn').addEventListener('click', saveYamlFile);
    document.getElementById('generate-from-yaml-btn').addEventListener('click', generateFromEditor);

    // Diff mode actions
    document.getElementById('accept-changes-btn').addEventListener('click', () => {
        const value = document.getElementById('diff-right-editor').value;
        exitDiffMode(value);
        lastYamlSource = 'editor';
    });
    document.getElementById('revert-changes-btn').addEventListener('click', () => {
        exitDiffMode(originalYamlForDiff);
        lastYamlSource = 'editor';
    });

    // AI actions
    document.getElementById('ai-back-btn').addEventListener('click', () => showView('home-view'));
    document.getElementById('generate-ai-btn').addEventListener('click', generateAiResume);

    // Restore OpenAI key from localStorage
    const savedKey = localStorage.getItem('openai-api-key');
    if (savedKey) document.getElementById('openai-key').value = savedKey;

    // Save key on change and fetch models
    document.getElementById('openai-key').addEventListener('change', (e) => {
        const key = e.target.value.trim();
        localStorage.setItem('openai-api-key', key);
        if (key) fetchOpenAiModels(key);
    });

    // Fetch models if we already have a saved key
    if (savedKey) fetchOpenAiModels(savedKey);

    // Restore saved model selection
    const savedModel = localStorage.getItem('openai-model');
    if (savedModel) document.getElementById('ai-model').value = savedModel;
    document.getElementById('ai-model').addEventListener('change', (e) => {
        localStorage.setItem('openai-model', e.target.value);
    });

    restoreFromLocalStorage();

    // Debounced resize handler for orientation changes (font consistency)
    window.addEventListener('resize', () => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (document.getElementById('preview-view').classList.contains('active')) {
                showPreview();
            }
        }, 200);
    });

    // Mobile reorder sheet toggle
    document.getElementById('mobile-reorder-toggle').addEventListener('click', () => {
        document.getElementById('mobile-reorder-sheet').classList.toggle('expanded');
    });
});

// ============================================================
// Drop Zone Setup
// ============================================================
function setupDropZone(zoneId, inputId, handler) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handler(file);
    });

    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handler(file);
        input.value = '';
    });
}

// ============================================================
// YAML File Handling
// ============================================================
function handleYamlFile(file) {
    if (!file.name.match(/\.(yaml|yml)$/i)) {
        alert('Please select a .yaml or .yml file.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        try {
            jsyaml.load(text);
            document.getElementById('yaml-editor').value = text;
            lastYamlSource = 'editor';
            showView('editor-view');
        } catch (err) {
            alert('Invalid YAML file: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function handleAiYamlFile(file) {
    if (!file.name.match(/\.(yaml|yml)$/i)) {
        alert('Please select a .yaml or .yml file.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('ai-base-yaml').value = e.target.result;
    };
    reader.readAsText(file);
}

// ============================================================
// Step Navigation (Wizard)
// ============================================================
function goToStep(step) {
    if (step < 1 || step > totalSteps) return;

    saveToLocalStorage();

    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const targetStep = document.querySelector(`.step[data-step="${step}"]`);
    if (targetStep) targetStep.classList.add('active');

    document.querySelectorAll('.progress-step').forEach(el => {
        const s = parseInt(el.dataset.step);
        el.classList.remove('active', 'completed');
        if (s === step) el.classList.add('active');
        else if (s < step) el.classList.add('completed');
    });

    const lines = document.querySelectorAll('.progress-line');
    lines.forEach((line, i) => {
        line.classList.toggle('filled', i < step - 1);
    });

    document.getElementById('prev-btn').style.display = step === 1 ? 'none' : '';

    // On last step, change Next to "Preview Resume"
    const nextBtn = document.getElementById('next-btn');
    if (step === totalSteps) {
        nextBtn.textContent = 'Preview Resume';
    } else {
        nextBtn.textContent = 'Next';
    }

    document.getElementById('load-example-btn').style.display = step === totalSteps ? 'none' : '';

    currentStep = step;
}

function nextStep() {
    if (currentStep === 1 && !validatePersonalInfo()) return;

    if (currentStep === totalSteps) {
        // Generate preview from wizard data
        const data = collectFormData();
        lastResumeData = data;
        lastYamlSource = 'wizard';
        renderResumeFromData(data);
        return;
    }

    goToStep(currentStep + 1);
}

function prevStep() {
    goToStep(currentStep - 1);
}

function validatePersonalInfo() {
    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    if (!name) {
        alert('Please enter your full name.');
        document.getElementById('name').focus();
        return false;
    }
    if (!email) {
        alert('Please enter your email address.');
        document.getElementById('email').focus();
        return false;
    }
    return true;
}

// ============================================================
// Dynamic Job Entries
// ============================================================
function addJobEntry(data) {
    jobCounter++;
    const id = jobCounter;
    const container = document.getElementById('jobs-container');
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.id = `job-${id}`;

    const header = document.createElement('div');
    header.className = 'entry-card-header';
    const h3 = document.createElement('h3');
    h3.textContent = `Position ${id}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeEntry(`job-${id}`));
    header.appendChild(h3);
    header.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(createFormGroup('Company Name', 'text', 'job-company', 'e.g. Acme Corp', data?.company));
    grid.appendChild(createFormGroup('Job Title', 'text', 'job-title', 'e.g. Software Engineer', data?.title));
    grid.appendChild(createFormGroup('Location', 'text', 'job-location', 'e.g. New York, NY', data?.location));
    grid.appendChild(createFormGroup('Dates', 'text', 'job-dates', 'e.g. Jan 2022 - Present', data?.dates));
    grid.appendChild(createFormGroup('Company Description (optional, shown in italics)', 'text', 'job-tagline', 'e.g. A leading provider of cloud solutions', data?.tagline, true));

    const respGroup = document.createElement('div');
    respGroup.className = 'form-group full-width';
    const respLabel = document.createElement('label');
    respLabel.textContent = 'Key Responsibilities & Achievements';
    const respTextarea = document.createElement('textarea');
    respTextarea.className = 'job-responsibilities';
    respTextarea.rows = 5;
    respTextarea.placeholder = 'Write one bullet point per line. Start each with a strong verb.\n\nExample:\nDeveloped REST APIs serving 10M+ requests per day\nLed a team of 5 engineers to deliver the new billing system';
    respTextarea.value = data?.responsibilities || '';
    const respHint = document.createElement('span');
    respHint.className = 'responsibilities-help';
    respHint.textContent = 'One bullet point per line. Each becomes a bullet on your resume.';
    respGroup.appendChild(respLabel);
    respGroup.appendChild(respTextarea);
    respGroup.appendChild(respHint);
    grid.appendChild(respGroup);

    card.appendChild(header);
    card.appendChild(grid);
    container.appendChild(card);
}

// ============================================================
// Dynamic Education Entries
// ============================================================
function addEducationEntry(data) {
    eduCounter++;
    const id = eduCounter;
    const container = document.getElementById('education-container');
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.id = `edu-${id}`;

    const header = document.createElement('div');
    header.className = 'entry-card-header';
    const h3 = document.createElement('h3');
    h3.textContent = `Education ${id}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeEntry(`edu-${id}`));
    header.appendChild(h3);
    header.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(createFormGroup('Institution', 'text', 'edu-institution', 'e.g. MIT', data?.institution));
    grid.appendChild(createFormGroup('Location', 'text', 'edu-location', 'e.g. Cambridge, MA', data?.location));
    grid.appendChild(createFormGroup('Graduation Date', 'text', 'edu-date', 'e.g. May 2022', data?.graduation_date));
    grid.appendChild(createFormGroup('Details', 'text', 'edu-details', 'e.g. B.S. Computer Science, GPA 3.8', data?.details));

    card.appendChild(header);
    card.appendChild(grid);
    container.appendChild(card);
}

// ============================================================
// Dynamic Project Entries
// ============================================================
function addProjectEntry(data) {
    projectCounter++;
    const id = projectCounter;
    const container = document.getElementById('projects-container');
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.id = `project-${id}`;

    const header = document.createElement('div');
    header.className = 'entry-card-header';
    const h3 = document.createElement('h3');
    h3.textContent = `Project ${id}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeEntry(`project-${id}`));
    header.appendChild(h3);
    header.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(createFormGroup('Project Name', 'text', 'project-name', 'e.g. Piper Chat', data?.name));
    grid.appendChild(createFormGroup('Link to Project', 'url', 'project-link', 'e.g. http://piperchat.com', data?.link));
    grid.appendChild(createFormGroup('Tools Used', 'text', 'project-tools', 'e.g. Java, React, WebRTC', data?.tools, true));

    const descGroup = document.createElement('div');
    descGroup.className = 'form-group full-width';
    const descLabel = document.createElement('label');
    descLabel.textContent = 'Project Description';
    const descTextarea = document.createElement('textarea');
    descTextarea.className = 'project-description';
    descTextarea.rows = 3;
    descTextarea.placeholder = 'Briefly describe what the project does and your role in it.';
    descTextarea.value = data?.description || '';
    descGroup.appendChild(descLabel);
    descGroup.appendChild(descTextarea);
    grid.appendChild(descGroup);

    card.appendChild(header);
    card.appendChild(grid);
    container.appendChild(card);
}

// ============================================================
// Dynamic Award Entries
// ============================================================
function addAwardEntry(data) {
    awardCounter++;
    const id = awardCounter;
    const container = document.getElementById('awards-container');
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.id = `award-${id}`;

    const header = document.createElement('div');
    header.className = 'entry-card-header';
    const h3 = document.createElement('h3');
    h3.textContent = `Award ${id}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeEntry(`award-${id}`));
    header.appendChild(h3);
    header.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(createFormGroup('Award Name', 'text', 'award-name', 'e.g. Salesman of the Month', data?.name));
    grid.appendChild(createFormGroup('Awarder', 'text', 'award-awarder', 'e.g. Dunder Mifflin', data?.awarder));
    grid.appendChild(createFormGroup('Date', 'text', 'award-date', 'e.g. May 2015', data?.date));

    const summaryGroup = document.createElement('div');
    summaryGroup.className = 'form-group full-width';
    const summaryLabel = document.createElement('label');
    summaryLabel.textContent = 'Summary';
    const summaryTextarea = document.createElement('textarea');
    summaryTextarea.className = 'award-summary';
    summaryTextarea.rows = 2;
    summaryTextarea.placeholder = 'Briefly describe the award or recognition.';
    summaryTextarea.value = data?.summary || '';
    summaryGroup.appendChild(summaryLabel);
    summaryGroup.appendChild(summaryTextarea);
    grid.appendChild(summaryGroup);

    card.appendChild(header);
    card.appendChild(grid);
    container.appendChild(card);
}

// ============================================================
// Dynamic Publication Entries
// ============================================================
function addPublicationEntry(data) {
    publicationCounter++;
    const id = publicationCounter;
    const container = document.getElementById('publications-container');
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.id = `publication-${id}`;

    const header = document.createElement('div');
    header.className = 'entry-card-header';
    const h3 = document.createElement('h3');
    h3.textContent = `Publication ${id}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeEntry(`publication-${id}`));
    header.appendChild(h3);
    header.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(createFormGroup('Title', 'text', 'pub-title', 'e.g. Machine Learning in Paper Sales', data?.title));
    grid.appendChild(createFormGroup('Publisher / Venue', 'text', 'pub-publisher', 'e.g. Journal of Business, Conference Name', data?.publisher));
    grid.appendChild(createFormGroup('Date', 'text', 'pub-date', 'e.g. June 2020', data?.date));
    grid.appendChild(createFormGroup('Link', 'url', 'pub-link', 'e.g. https://doi.org/...', data?.link));

    const summaryGroup = document.createElement('div');
    summaryGroup.className = 'form-group full-width';
    const summaryLabel = document.createElement('label');
    summaryLabel.textContent = 'Summary';
    const summaryTextarea = document.createElement('textarea');
    summaryTextarea.className = 'pub-summary';
    summaryTextarea.rows = 2;
    summaryTextarea.placeholder = 'Briefly describe the publication.';
    summaryTextarea.value = data?.summary || '';
    summaryGroup.appendChild(summaryLabel);
    summaryGroup.appendChild(summaryTextarea);
    grid.appendChild(summaryGroup);

    card.appendChild(header);
    card.appendChild(grid);
    container.appendChild(card);
}

// ============================================================
// Dynamic Custom Section Entries
// ============================================================
function addCustomSectionEntry(data) {
    customSectionCounter++;
    const id = customSectionCounter;
    const container = document.getElementById('custom-sections-container');
    const card = document.createElement('div');
    card.className = 'entry-card';
    card.id = `custom-section-${id}`;

    const header = document.createElement('div');
    header.className = 'entry-card-header';
    const h3 = document.createElement('h3');
    h3.textContent = `Custom Section ${id}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeEntry(`custom-section-${id}`));
    header.appendChild(h3);
    header.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'form-grid';
    grid.appendChild(createFormGroup('Section Heading', 'text', 'custom-heading', 'e.g. Interests & Hobbies, Volunteer Work, etc.', data?.heading, true));

    const contentGroup = document.createElement('div');
    contentGroup.className = 'form-group full-width';
    const contentLabel = document.createElement('label');
    contentLabel.textContent = 'Content';
    const contentTextarea = document.createElement('textarea');
    contentTextarea.className = 'custom-content';
    contentTextarea.rows = 4;
    contentTextarea.placeholder = 'Enter content for this section. One item per line for bullet points, or write a paragraph.';
    contentTextarea.value = data?.content || '';
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'One item per line becomes bullet points. A single line is displayed as a paragraph.';
    contentGroup.appendChild(contentLabel);
    contentGroup.appendChild(contentTextarea);
    contentGroup.appendChild(hint);
    grid.appendChild(contentGroup);

    card.appendChild(header);
    card.appendChild(grid);
    container.appendChild(card);
}

function createFormGroup(labelText, inputType, className, placeholder, value, fullWidth) {
    const group = document.createElement('div');
    group.className = 'form-group' + (fullWidth ? ' full-width' : '');
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = inputType;
    input.className = className;
    input.placeholder = placeholder || '';
    input.value = value || '';
    group.appendChild(label);
    group.appendChild(input);
    return group;
}

function removeEntry(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// ============================================================
// Collect Form Data (from wizard)
// ============================================================
function collectFormData() {
    const data = {
        name: document.getElementById('name').value.trim(),
        contact: {
            phone: document.getElementById('phone').value.trim(),
            email: document.getElementById('email').value.trim(),
            location: document.getElementById('location').value.trim(),
            linkedin: document.getElementById('linkedin').value.trim(),
            github: document.getElementById('github').value.trim(),
        },
        work_experience: [],
        education: [],
        projects: [],
        awards: [],
        publications: [],
        custom_sections: [],
        skills: {},
    };

    document.querySelectorAll('#jobs-container .entry-card').forEach(card => {
        const responsibilities = card.querySelector('.job-responsibilities').value
            .split('\n').map(s => s.trim()).filter(s => s.length > 0);
        const job = {
            company: card.querySelector('.job-company').value.trim(),
            title: card.querySelector('.job-title').value.trim(),
            location: card.querySelector('.job-location').value.trim(),
            dates: card.querySelector('.job-dates').value.trim(),
            tagline: card.querySelector('.job-tagline').value.trim(),
            responsibilities,
        };
        if (job.company || job.title) data.work_experience.push(job);
    });

    document.querySelectorAll('#education-container .entry-card').forEach(card => {
        const edu = {
            institution: card.querySelector('.edu-institution').value.trim(),
            location: card.querySelector('.edu-location').value.trim(),
            graduation_date: card.querySelector('.edu-date').value.trim(),
            details: card.querySelector('.edu-details').value.trim(),
        };
        if (edu.institution) data.education.push(edu);
    });

    document.querySelectorAll('#projects-container .entry-card').forEach(card => {
        const project = {
            name: card.querySelector('.project-name').value.trim(),
            description: card.querySelector('.project-description').value.trim(),
            link: card.querySelector('.project-link').value.trim(),
            tools: card.querySelector('.project-tools').value.trim(),
        };
        if (project.name) data.projects.push(project);
    });

    document.querySelectorAll('#awards-container .entry-card').forEach(card => {
        const award = {
            name: card.querySelector('.award-name').value.trim(),
            awarder: card.querySelector('.award-awarder').value.trim(),
            date: card.querySelector('.award-date').value.trim(),
            summary: card.querySelector('.award-summary').value.trim(),
        };
        if (award.name) data.awards.push(award);
    });

    document.querySelectorAll('#publications-container .entry-card').forEach(card => {
        const pub = {
            title: card.querySelector('.pub-title').value.trim(),
            publisher: card.querySelector('.pub-publisher').value.trim(),
            date: card.querySelector('.pub-date').value.trim(),
            link: card.querySelector('.pub-link').value.trim(),
            summary: card.querySelector('.pub-summary').value.trim(),
        };
        if (pub.title) data.publications.push(pub);
    });

    document.querySelectorAll('#custom-sections-container .entry-card').forEach(card => {
        const section = {
            heading: card.querySelector('.custom-heading').value.trim(),
            content: card.querySelector('.custom-content').value.trim(),
        };
        if (section.heading && section.content) data.custom_sections.push(section);
    });

    const techs = document.getElementById('technologies').value.trim();
    const hardSkills = document.getElementById('hard-skills').value.trim();
    const langSkills = document.getElementById('language-skills').value.trim();
    if (techs) data.skills.technologies = techs.split(',').map(s => s.trim()).filter(Boolean);
    if (hardSkills) data.skills.hard_skills = hardSkills.split(',').map(s => s.trim()).filter(Boolean);
    if (langSkills) data.skills.language_skills = langSkills;

    return data;
}

// ============================================================
// Data ↔ YAML Conversion
// ============================================================
function dataToYaml(data) {
    return jsyaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false });
}

function parseSortDate(dateStr) {
    if (!dateStr) return 0;
    dateStr = dateStr.trim();
    if (/present/i.test(dateStr)) return 999999;
    const months = {
        jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
        apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
        aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
        nov: 10, november: 10, dec: 11, december: 11,
    };
    const monthYear = dateStr.match(/([a-z]+)\s+(\d{4})/i);
    if (monthYear) {
        const month = months[monthYear[1].toLowerCase()];
        const year = parseInt(monthYear[2]);
        if (month !== undefined && !isNaN(year)) return year * 12 + month;
    }
    const yearOnly = dateStr.match(/(\d{4})/);
    if (yearOnly) return parseInt(yearOnly[1]) * 12;
    return 0;
}

function yamlToData(yamlStr) {
    const data = jsyaml.load(yamlStr);
    if (!data || typeof data !== 'object') {
        throw new Error('YAML must contain an object with resume fields.');
    }
    // Normalize: ensure expected structure
    data.name = data.name || '';
    data.contact = data.contact || {};
    data.work_experience = data.work_experience || [];
    data.education = data.education || [];
    data.projects = data.projects || [];
    data.awards = data.awards || [];
    data.publications = data.publications || [];
    data.custom_sections = data.custom_sections || [];
    data.skills = data.skills || {};
    // Ensure responsibilities are arrays
    data.work_experience.forEach(job => {
        if (typeof job.responsibilities === 'string') {
            job.responsibilities = job.responsibilities.split('\n').map(s => s.trim()).filter(Boolean);
        }
        job.responsibilities = job.responsibilities || [];
    });
    // Normalize education dates (e.g. "Present (August 2024 - )" → "August 2024 - Present")
    data.education.forEach(edu => {
        if (edu.graduation_date) {
            const match = edu.graduation_date.match(/^Present\s*\((.+?)\s*-\s*\)$/i);
            if (match) {
                edu.graduation_date = `${match[1]} - Present`;
            }
        }
    });
    // Normalize custom section content to strings
    data.custom_sections.forEach(section => {
        if (Array.isArray(section.content)) {
            section.content = section.content.join('\n');
        }
        section.content = section.content || '';
        section.heading = section.heading || 'Additional Information';
    });
    // Sort entries in reverse chronological order (most recent first)
    const endDateOf = (dateStr) => {
        if (!dateStr) return 0;
        const parts = dateStr.split(/\s*[-–—]\s*/);
        return parseSortDate(parts[parts.length - 1]);
    };
    const startDateOf = (dateStr) => {
        if (!dateStr) return 0;
        const parts = dateStr.split(/\s*[-–—]\s*/);
        return parseSortDate(parts[0]);
    };
    data.work_experience.sort((a, b) => {
        const endDiff = endDateOf(b.dates) - endDateOf(a.dates);
        if (endDiff !== 0) return endDiff;
        return startDateOf(b.dates) - startDateOf(a.dates);
    });
    data.education.sort((a, b) => parseSortDate(b.graduation_date) - parseSortDate(a.graduation_date));
    data.awards.sort((a, b) => parseSortDate(b.date) - parseSortDate(a.date));
    data.publications.sort((a, b) => parseSortDate(b.date) - parseSortDate(a.date));
    return data;
}

// ============================================================
// Render Resume from Data Object
// ============================================================
function renderResumeFromData(data) {
    lastResumeData = data;
    sectionOrder = null;
    pageLayoutMode = 'auto';
    targetPageCount = null;
    sectionPageAssignments = {};
    computedPageAssignments = {};
    textShrinkPercent = 100;
    document.documentElement.style.setProperty('--text-scale', '1');

    const staging = document.getElementById('resume-staging');
    const renderTarget = document.getElementById('resume-render-target');

    // Make staging visible for accurate measurement
    staging.style.position = 'static';
    staging.style.left = 'auto';

    populateResumeDOM(data);

    // Use rAF to ensure browser has laid out the element before measuring
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            paginateResume();

            // Hide staging
            staging.style.position = 'absolute';
            staging.style.left = '-9999px';

            // Show the preview
            showView('preview-view');
            buildSectionSidebar();
            buildMobileReorderSheet();

            // Make render target visible temporarily for preview cloning
            renderTarget.style.position = 'static';
            renderTarget.style.left = 'auto';

            requestAnimationFrame(() => {
                showPreview();

                // Hide render target again
                renderTarget.style.position = 'absolute';
                renderTarget.style.left = '-9999px';
            });
        });
    });
}

function populateResumeDOM(data) {
    // --- Header ---
    document.getElementById('rp-name').textContent = data.name;

    const contactInfo = document.getElementById('rp-contact-info');
    contactInfo.textContent = '';
    const contactParts = [];
    if (data.contact.phone) contactParts.push({ type: 'text', value: data.contact.phone });
    if (data.contact.location) contactParts.push({ type: 'text', value: data.contact.location });
    if (data.contact.linkedin) contactParts.push({ type: 'link', href: data.contact.linkedin, text: 'LinkedIn' });
    if (data.contact.github) contactParts.push({ type: 'link', href: data.contact.github, text: 'GitHub' });
    if (data.contact.email) contactParts.push({ type: 'link', href: `mailto:${data.contact.email}`, text: data.contact.email });

    contactParts.forEach((part, i) => {
        if (i > 0) contactInfo.appendChild(document.createTextNode(' | '));
        if (part.type === 'link') {
            const a = document.createElement('a');
            a.href = part.href;
            a.textContent = part.text;
            contactInfo.appendChild(a);
        } else {
            contactInfo.appendChild(document.createTextNode(part.value));
        }
    });

    // --- Work Experience ---
    const workContainer = document.getElementById('rp-work-container');
    const workSection = document.getElementById('rp-work-section');
    workContainer.textContent = '';
    if (data.work_experience.length > 0) {
        workSection.style.display = 'block';
        data.work_experience.forEach(job => {
            workContainer.appendChild(createResumeJobElement(job));
        });
    } else {
        workSection.style.display = 'none';
    }

    // --- Education ---
    const eduContainer = document.getElementById('rp-education-container');
    const eduSection = document.getElementById('rp-education-section');
    eduContainer.textContent = '';
    if (data.education.length > 0) {
        eduSection.style.display = 'block';
        data.education.forEach(edu => {
            eduContainer.appendChild(createResumeEduElement(edu));
        });
    } else {
        eduSection.style.display = 'none';
    }

    // --- Projects ---
    const projectsContainer = document.getElementById('rp-projects-container');
    const projectsSection = document.getElementById('rp-projects-section');
    projectsContainer.textContent = '';
    if (data.projects && data.projects.length > 0) {
        projectsSection.style.display = 'block';
        data.projects.forEach(project => {
            projectsContainer.appendChild(createResumeProjectElement(project));
        });
    } else {
        projectsSection.style.display = 'none';
    }

    // --- Awards ---
    const awardsContainer = document.getElementById('rp-awards-container');
    const awardsSection = document.getElementById('rp-awards-section');
    awardsContainer.textContent = '';
    if (data.awards && data.awards.length > 0) {
        awardsSection.style.display = 'block';
        data.awards.forEach(award => {
            awardsContainer.appendChild(createResumeAwardElement(award));
        });
    } else {
        awardsSection.style.display = 'none';
    }

    // --- Publications ---
    const pubsContainer = document.getElementById('rp-publications-container');
    const pubsSection = document.getElementById('rp-publications-section');
    pubsContainer.textContent = '';
    if (data.publications && data.publications.length > 0) {
        pubsSection.style.display = 'block';
        data.publications.forEach(pub => {
            pubsContainer.appendChild(createResumePublicationElement(pub));
        });
    } else {
        pubsSection.style.display = 'none';
    }

    // --- Custom Sections ---
    const customContainer = document.getElementById('rp-custom-sections-container');
    customContainer.textContent = '';
    if (data.custom_sections && data.custom_sections.length > 0) {
        data.custom_sections.forEach((section, idx) => {
            const el = createResumeCustomSectionElement(section);
            el.id = `rp-custom-${idx}`;
            el.dataset.customLabel = section.heading;
            customContainer.appendChild(el);
        });
    }

    // --- Skills ---
    const skillsTbody = document.getElementById('rp-skills-tbody');
    const skillsSection = document.getElementById('rp-skills-section');
    skillsTbody.textContent = '';
    const hasSkills = data.skills && Object.keys(data.skills).length > 0;
    if (hasSkills) {
        skillsSection.style.display = 'block';
        const formatTitle = key => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        for (const key in data.skills) {
            const val = Array.isArray(data.skills[key]) ? data.skills[key].join('; ') : data.skills[key];
            if (val) {
                const tr = document.createElement('tr');
                const tdLabel = document.createElement('td');
                tdLabel.className = 'js-resizable-text';
                tdLabel.textContent = formatTitle(key) + ':';
                const tdValue = document.createElement('td');
                tdValue.className = 'js-resizable-text';
                tdValue.textContent = val;
                tr.appendChild(tdLabel);
                tr.appendChild(tdValue);
                skillsTbody.appendChild(tr);
            }
        }
    } else {
        skillsSection.style.display = 'none';
    }
}

function createResumeJobElement(job) {
    const div = document.createElement('div');
    div.className = 'rp-job';

    const header1 = document.createElement('div');
    header1.className = 'rp-job-header js-resizable-text';
    const companySpan = document.createElement('span');
    companySpan.className = 'rp-company-name';
    companySpan.textContent = job.company;
    const locSpan = document.createElement('span');
    locSpan.className = 'rp-location';
    locSpan.textContent = job.location;
    header1.appendChild(companySpan);
    header1.appendChild(locSpan);

    const header2 = document.createElement('div');
    header2.className = 'rp-job-header js-resizable-text';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'rp-job-title';
    titleSpan.textContent = job.title;
    const dateSpan = document.createElement('span');
    dateSpan.className = 'rp-date';
    dateSpan.textContent = job.dates;
    header2.appendChild(titleSpan);
    header2.appendChild(dateSpan);

    const ul = document.createElement('ul');
    ul.className = 'rp-description';
    if (job.tagline) {
        const tagLi = document.createElement('li');
        tagLi.className = 'rp-company-tagline js-resizable-text';
        const em = document.createElement('i');
        em.textContent = job.tagline;
        tagLi.appendChild(em);
        ul.appendChild(tagLi);
    }
    (job.responsibilities || []).forEach(r => {
        const li = document.createElement('li');
        li.className = 'js-resizable-text';
        li.textContent = r;
        ul.appendChild(li);
    });

    div.appendChild(header1);
    div.appendChild(header2);
    div.appendChild(ul);
    return div;
}

function createResumeEduElement(edu) {
    const div = document.createElement('div');
    div.className = 'rp-education';

    const header = document.createElement('div');
    header.className = 'rp-degree-header js-resizable-text';
    const schoolSpan = document.createElement('span');
    schoolSpan.className = 'rp-school-name';
    const b = document.createElement('b');
    b.textContent = edu.institution;
    schoolSpan.appendChild(b);
    if (edu.location) {
        schoolSpan.appendChild(document.createTextNode('; ' + edu.location));
    }
    const dateSpan = document.createElement('span');
    dateSpan.className = 'rp-date';
    dateSpan.textContent = edu.graduation_date;
    header.appendChild(schoolSpan);
    header.appendChild(dateSpan);

    const details = document.createElement('p');
    details.className = 'rp-details js-resizable-text';
    details.textContent = edu.details;

    div.appendChild(header);
    div.appendChild(details);
    return div;
}

function createResumeProjectElement(project) {
    const div = document.createElement('div');
    div.className = 'rp-project';

    const header = document.createElement('div');
    header.className = 'rp-project-header js-resizable-text';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'rp-project-name';
    const b = document.createElement('b');
    b.textContent = project.name;
    nameSpan.appendChild(b);
    if (project.tools) {
        nameSpan.appendChild(document.createTextNode(' | ' + project.tools));
    }
    header.appendChild(nameSpan);
    if (project.link) {
        const linkSpan = document.createElement('span');
        linkSpan.className = 'rp-project-link';
        const a = document.createElement('a');
        a.href = project.link;
        a.textContent = project.link;
        linkSpan.appendChild(a);
        header.appendChild(linkSpan);
    }

    div.appendChild(header);

    if (project.description) {
        const desc = document.createElement('p');
        desc.className = 'rp-project-desc js-resizable-text';
        desc.textContent = project.description;
        div.appendChild(desc);
    }

    return div;
}

function createResumeCustomSectionElement(section) {
    const wrapper = document.createElement('div');
    wrapper.className = 'rp-custom-section';

    const title = document.createElement('div');
    title.className = 'rp-section-title';
    title.textContent = section.heading.toUpperCase();
    wrapper.appendChild(title);

    const lines = section.content.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length === 1) {
        const p = document.createElement('p');
        p.className = 'rp-custom-paragraph';
        p.textContent = lines[0];
        wrapper.appendChild(p);
    } else {
        const ul = document.createElement('ul');
        ul.className = 'rp-description';
        lines.forEach(line => {
            const li = document.createElement('li');
            li.textContent = line;
            ul.appendChild(li);
        });
        wrapper.appendChild(ul);
    }

    return wrapper;
}

function createResumeAwardElement(award) {
    const div = document.createElement('div');
    div.className = 'rp-award';

    const header = document.createElement('div');
    header.className = 'rp-award-header js-resizable-text';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'rp-award-name';
    const b = document.createElement('b');
    b.textContent = award.name;
    nameSpan.appendChild(b);
    if (award.awarder) {
        nameSpan.appendChild(document.createTextNode(' — ' + award.awarder));
    }
    header.appendChild(nameSpan);
    if (award.date) {
        const dateSpan = document.createElement('span');
        dateSpan.className = 'rp-date';
        dateSpan.textContent = award.date;
        header.appendChild(dateSpan);
    }

    div.appendChild(header);

    if (award.summary) {
        const desc = document.createElement('p');
        desc.className = 'rp-award-summary js-resizable-text';
        desc.textContent = award.summary;
        div.appendChild(desc);
    }

    return div;
}

function createResumePublicationElement(pub) {
    const div = document.createElement('div');
    div.className = 'rp-publication';

    const header = document.createElement('div');
    header.className = 'rp-pub-header js-resizable-text';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'rp-pub-title';
    const b = document.createElement('b');
    b.textContent = pub.title;
    titleSpan.appendChild(b);
    if (pub.publisher) {
        titleSpan.appendChild(document.createTextNode(' — ' + pub.publisher));
    }
    header.appendChild(titleSpan);
    if (pub.date) {
        const dateSpan = document.createElement('span');
        dateSpan.className = 'rp-date';
        dateSpan.textContent = pub.date;
        header.appendChild(dateSpan);
    }

    div.appendChild(header);

    if (pub.summary) {
        const desc = document.createElement('p');
        desc.className = 'rp-pub-summary js-resizable-text';
        desc.textContent = pub.summary;
        div.appendChild(desc);
    }

    if (pub.link) {
        const linkP = document.createElement('p');
        linkP.className = 'rp-pub-link js-resizable-text';
        const a = document.createElement('a');
        a.href = pub.link;
        a.textContent = pub.link;
        linkP.appendChild(a);
        div.appendChild(linkP);
    }

    return div;
}

// ============================================================
// Multi-page Pagination
// ============================================================
function paginateResume() {
    const staging = document.getElementById('resume-staging-inner');
    const renderTarget = document.getElementById('resume-render-target');
    renderTarget.textContent = '';

    const USABLE_HEIGHT = (11 - 0.5) * 96; // 1008px

    const groups = collectBlockGroups(staging);
    if (groups.length === 0) return;

    const stagingRect = staging.getBoundingClientRect();

    if (pageLayoutMode === 'manual' && targetPageCount !== null) {
        paginateManual(groups, stagingRect, USABLE_HEIGHT, renderTarget);
    } else {
        paginateAutomatic(groups, stagingRect, USABLE_HEIGHT, renderTarget);
    }
}

function paginateAutomatic(groups, stagingRect, USABLE_HEIGHT, renderTarget) {
    const pages = [[]];
    let pageBreakAt = USABLE_HEIGHT;

    for (const group of groups) {
        const firstRect = group.elements[0].getBoundingClientRect();
        const lastRect = group.elements[group.elements.length - 1].getBoundingClientRect();
        const groupTop = firstRect.top - stagingRect.top;
        const groupBottom = lastRect.bottom - stagingRect.top;

        if (pages[pages.length - 1].length > 0 && groupBottom > pageBreakAt) {
            pages.push([]);
            pageBreakAt = groupTop + USABLE_HEIGHT;
        }

        pages[pages.length - 1].push(group);
    }

    // Record which page each section ended up on
    computedPageAssignments = {};
    pages.forEach((pageGroups, pageIdx) => {
        pageGroups.forEach(group => {
            if (!(group.sectionId in computedPageAssignments)) {
                computedPageAssignments[group.sectionId] = pageIdx + 1;
            }
        });
    });

    buildPageDOMs(pages, renderTarget);
}

function paginateManual(groups, stagingRect, USABLE_HEIGHT, renderTarget) {
    // Initialize empty page buckets with height tracking
    const pageBuckets = [];
    const pageHeights = [];
    for (let i = 0; i < targetPageCount; i++) {
        pageBuckets.push([]);
        pageHeights.push(0);
    }

    // Separate explicitly assigned groups from unassigned ones
    const assignedGroups = [];
    const unassignedGroups = [];

    for (const group of groups) {
        if (group.sectionId === 'rp-header') {
            // Header always goes to page 1
            assignedGroups.push({ group, targetPage: 0 });
        } else if (sectionPageAssignments[group.sectionId] !== undefined) {
            const tp = Math.max(0, Math.min(sectionPageAssignments[group.sectionId] - 1, pageBuckets.length - 1));
            assignedGroups.push({ group, targetPage: tp });
        } else {
            unassignedGroups.push(group);
        }
    }

    // Place explicitly assigned groups first and track their heights
    for (const { group, targetPage } of assignedGroups) {
        pageBuckets[targetPage].push(group);
        pageHeights[targetPage] += measureGroupHeight(group, stagingRect);
    }

    // Auto-distribute unassigned groups using greedy allocation
    for (const group of unassignedGroups) {
        const height = measureGroupHeight(group, stagingRect);
        // Find first page with room
        let placed = false;
        for (let p = 0; p < pageBuckets.length; p++) {
            if (pageHeights[p] + height <= USABLE_HEIGHT || pageBuckets[p].length === 0) {
                pageBuckets[p].push(group);
                pageHeights[p] += height;
                placed = true;
                break;
            }
        }
        // If no page has room, add to the last page
        if (!placed) {
            pageBuckets[pageBuckets.length - 1].push(group);
            pageHeights[pageBuckets.length - 1] += height;
        }
    }

    // Check height constraints — if a page overflows, push excess to next page
    const finalPages = [];

    for (let p = 0; p < pageBuckets.length; p++) {
        const bucket = pageBuckets[p];
        let currentPage = [];
        let usedHeight = 0;

        for (const group of bucket) {
            const height = measureGroupHeight(group, stagingRect);

            if (currentPage.length > 0 && usedHeight + height > USABLE_HEIGHT) {
                finalPages.push(currentPage);
                currentPage = [];
                usedHeight = 0;
            }

            currentPage.push(group);
            usedHeight += height;
        }

        if (currentPage.length > 0) {
            finalPages.push(currentPage);
        }
    }

    // Ensure at least targetPageCount pages exist (empty pages if needed)
    while (finalPages.length < targetPageCount) {
        finalPages.push([]);
    }

    // Record which page each section ended up on
    computedPageAssignments = {};
    finalPages.forEach((pageGroups, pageIdx) => {
        pageGroups.forEach(group => {
            if (!(group.sectionId in computedPageAssignments)) {
                computedPageAssignments[group.sectionId] = pageIdx + 1;
            }
        });
    });

    buildPageDOMs(finalPages, renderTarget);
    updateOverflowWarning(finalPages.length > targetPageCount);
}

function measureGroupHeight(group, stagingRect) {
    const firstRect = group.elements[0].getBoundingClientRect();
    const lastRect = group.elements[group.elements.length - 1].getBoundingClientRect();
    return lastRect.bottom - firstRect.top;
}

function buildPageDOMs(pages, renderTarget) {
    for (const pageGroups of pages) {
        const pageEl = document.createElement('div');
        pageEl.className = 'resume-page';

        const content = document.createElement('div');
        content.className = 'resume-page-content';

        for (const group of pageGroups) {
            for (const el of group.elements) {
                const clone = el.cloneNode(true);
                clone.removeAttribute('id');
                clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
                content.appendChild(clone);
            }
        }

        if (content.firstChild) {
            content.firstChild.style.marginTop = '0';
        }

        pageEl.appendChild(content);
        renderTarget.appendChild(pageEl);
    }
}

function collectBlockGroups(staging) {
    const groups = [];

    const header = staging.querySelector('.rp-header');
    if (header) {
        groups.push({ elements: [header], sectionId: 'rp-header' });
    }

    const sectionDefs = sectionOrder || DEFAULT_SECTION_DEFS;

    for (const def of sectionDefs) {
        const section = staging.querySelector('#' + def.id);
        if (!section || section.style.display === 'none') continue;

        if (!def.entryClass) {
            groups.push({ elements: [section], sectionId: def.id });
            continue;
        }

        if (def.isCustom) {
            const entries = Array.from(section.querySelectorAll('.' + def.entryClass));
            entries.forEach(entry => {
                const sid = entry.id || def.id;
                groups.push({ elements: [entry], sectionId: sid });
            });
            continue;
        }

        if (def.isCustomEntry) {
            const el = document.getElementById(def.id);
            if (el) groups.push({ elements: [el], sectionId: def.id });
            continue;
        }

        const title = section.querySelector('.rp-section-title');
        const entries = Array.from(section.querySelectorAll('.' + def.entryClass));

        if (entries.length === 0) continue;

        groups.push({ elements: [title, entries[0]], sectionId: def.id });

        for (let i = 1; i < entries.length; i++) {
            groups.push({ elements: [entries[i]], sectionId: def.id });
        }
    }

    return groups;
}

// ============================================================
// Show the Preview (scaled to fit the preview container)
// ============================================================
function showPreview() {
    const wrapper = document.getElementById('resume-preview-wrapper');
    wrapper.textContent = '';

    const pages = document.querySelectorAll('#resume-render-target .resume-page');
    const wrapperWidth = wrapper.clientWidth - 48;
    const pageWidth = 8.5 * 96;
    const pageHeight = 11 * 96;
    const scale = Math.min(wrapperWidth / pageWidth, 1);

    pages.forEach(page => {
        const clone = page.cloneNode(true);

        const scaler = document.createElement('div');
        scaler.className = 'resume-preview-scaler';
        scaler.style.transform = `scale(${scale})`;
        scaler.style.transformOrigin = 'top center';
        scaler.style.width = `${pageWidth}px`;
        scaler.style.height = `${pageHeight}px`;
        scaler.style.marginBottom = `-${pageHeight - pageHeight * scale}px`;
        scaler.appendChild(clone);

        wrapper.appendChild(scaler);
    });

    wrapper.style.height = '';
}

// ============================================================
// Section Reorder (Drag-and-Drop)
// ============================================================
function reorderStagingDOM(orderedDefs) {
    const staging = document.getElementById('resume-staging-inner');
    for (const def of orderedDefs) {
        const el = staging.querySelector('#' + def.id);
        if (el) staging.appendChild(el);
    }
}

function reRenderWithCurrentOrder() {
    const staging = document.getElementById('resume-staging');
    const renderTarget = document.getElementById('resume-render-target');

    staging.style.position = 'static';
    staging.style.left = 'auto';

    if (sectionOrder) {
        reorderStagingDOM(sectionOrder);
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            paginateResume();

            staging.style.position = 'absolute';
            staging.style.left = '-9999px';

            renderTarget.style.position = 'static';
            renderTarget.style.left = 'auto';

            requestAnimationFrame(() => {
                showPreview();
                buildSectionSidebar();
                buildMobileReorderSheet();

                renderTarget.style.position = 'absolute';
                renderTarget.style.left = '-9999px';
            });
        });
    });
}

function getActiveSectionDefs() {
    const defs = sectionOrder || DEFAULT_SECTION_DEFS;
    const result = [];
    for (const def of defs) {
        if (def.isCustom) {
            // Expand container into individual custom section entries
            const container = document.getElementById(def.id);
            if (!container) continue;
            const entries = container.querySelectorAll('.rp-custom-section');
            entries.forEach(entry => {
                result.push({
                    id: entry.id,
                    label: entry.dataset.customLabel || 'Custom Section',
                    isCustomEntry: true,
                });
            });
        } else if (def.isCustomEntry) {
            const el = document.getElementById(def.id);
            if (el) result.push(def);
        } else {
            const el = document.getElementById(def.id);
            if (el && el.style.display !== 'none') result.push(def);
        }
    }
    return result;
}

function buildSectionSidebar() {
    const existing = document.querySelector('.section-sidebar');
    if (existing) existing.remove();

    const activeDefs = getActiveSectionDefs();
    if (activeDefs.length === 0) return;

    const container = document.querySelector('.preview-container');
    const sidebar = document.createElement('div');
    sidebar.className = 'section-sidebar';

    // Page control UI
    sidebar.appendChild(buildPageControlUI('sidebar'));

    const title = document.createElement('div');
    title.className = 'sidebar-title';
    title.textContent = 'Section Order';
    sidebar.appendChild(title);

    // Determine page count from rendered output
    const pageCount = document.querySelectorAll('#resume-render-target .resume-page').length || 1;

    // Group sections by their computed page
    const pageGroups = {};
    for (let p = 1; p <= pageCount; p++) pageGroups[p] = [];
    activeDefs.forEach(def => {
        const page = computedPageAssignments[def.id] || 1;
        const clamped = Math.min(Math.max(page, 1), pageCount);
        if (!pageGroups[clamped]) pageGroups[clamped] = [];
        pageGroups[clamped].push(def);
    });

    const list = document.createElement('div');
    list.className = 'sidebar-list';

    // Max pages for dropdown options
    const maxPageOption = Math.max(pageCount, targetPageCount || 0, 3);

    for (let p = 1; p <= pageCount; p++) {
        // Page divider
        if (pageCount > 1) {
            const divider = document.createElement('div');
            divider.className = 'sidebar-page-divider';
            divider.textContent = 'Page ' + p;
            list.appendChild(divider);
        }

        // Header item on page 1
        if (p === 1) {
            const headerItem = document.createElement('div');
            headerItem.className = 'sidebar-item sidebar-item-fixed';
            const headerHandle = document.createElement('span');
            headerHandle.className = 'sidebar-drag-handle';
            headerHandle.textContent = '\u2261';
            headerHandle.style.visibility = 'hidden';
            const headerLabel = document.createElement('span');
            headerLabel.className = 'sidebar-item-label';
            headerLabel.textContent = 'Header';
            headerItem.appendChild(headerHandle);
            headerItem.appendChild(headerLabel);
            list.appendChild(headerItem);
        }

        // Section items for this page
        (pageGroups[p] || []).forEach(def => {
            const item = document.createElement('div');
            item.className = 'sidebar-item';
            item.draggable = true;
            item.dataset.sectionId = def.id;
            if (def.isCustomEntry) {
                item.dataset.isCustomEntry = 'true';
                item.dataset.label = def.label;
            }

            const handle = document.createElement('span');
            handle.className = 'sidebar-drag-handle';
            handle.textContent = '\u2261';

            const label = document.createElement('span');
            label.className = 'sidebar-item-label';
            label.textContent = def.label;

            item.appendChild(handle);
            item.appendChild(label);

            // Page select dropdown (shown when >1 page)
            if (pageCount > 1 || (pageLayoutMode === 'manual' && targetPageCount > 1)) {
                const select = document.createElement('select');
                select.className = 'sidebar-page-select';
                for (let pp = 1; pp <= maxPageOption; pp++) {
                    const opt = document.createElement('option');
                    opt.value = pp;
                    opt.textContent = 'P' + pp;
                    select.appendChild(opt);
                }
                select.value = computedPageAssignments[def.id] || 1;
                select.addEventListener('change', () => {
                    const newPage = parseInt(select.value);
                    // Auto-switch to manual mode
                    if (pageLayoutMode === 'auto') {
                        pageLayoutMode = 'manual';
                        targetPageCount = Math.max(pageCount, newPage);
                    }
                    // Pin all current positions before changing one
                    sectionPageAssignments = { ...computedPageAssignments };
                    sectionPageAssignments[def.id] = newPage;
                    if (targetPageCount !== null && newPage > targetPageCount) {
                        targetPageCount = newPage;
                    }
                    reRenderWithCurrentOrder();
                });
                item.appendChild(select);
            }

            list.appendChild(item);
        });
    }

    sidebar.appendChild(list);

    // Overflow warning
    const warning = document.createElement('div');
    warning.className = 'sidebar-overflow-warning';
    warning.id = 'sidebar-overflow-warning';
    warning.style.display = 'none';
    warning.textContent = 'Content overflows target page count.';
    sidebar.appendChild(warning);

    container.appendChild(sidebar);
    container.classList.add('has-sidebar');

    initSidebarDragAndDrop(list);
}

function initSidebarDragAndDrop(list) {
    let draggedItem = null;

    list.addEventListener('dragstart', (e) => {
        draggedItem = e.target.closest('.sidebar-item');
        if (!draggedItem) return;
        draggedItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    list.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!draggedItem) return;
        const afterElement = getDragAfterElement(list, e.clientY);
        if (afterElement) {
            list.insertBefore(draggedItem, afterElement);
        } else {
            list.appendChild(draggedItem);
        }
    });

    list.addEventListener('dragend', () => {
        if (!draggedItem) return;
        draggedItem.classList.remove('dragging');
        draggedItem = null;

        // Read new order from DOM (skips dividers and fixed header)
        const items = list.querySelectorAll('.sidebar-item');
        const newOrder = [];
        items.forEach(item => {
            const id = item.dataset.sectionId;
            if (item.dataset.isCustomEntry === 'true') {
                newOrder.push({
                    id: id,
                    label: item.dataset.label,
                    isCustomEntry: true,
                });
            } else {
                const def = DEFAULT_SECTION_DEFS.find(d => d.id === id);
                if (def) newOrder.push(def);
            }
        });
        sectionOrder = newOrder;
        reRenderWithCurrentOrder();
    });
}

function getDragAfterElement(container, y) {
    const items = [...container.querySelectorAll('.sidebar-item:not(.dragging)')];
    return items.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ============================================================
// Page Control UI (shared between desktop sidebar and mobile sheet)
// ============================================================
function buildPageControlUI(prefix) {
    const wrapper = document.createElement('div');
    wrapper.className = prefix + '-page-control';

    // Mode toggle: Auto / Manual
    const modeRow = document.createElement('div');
    modeRow.className = prefix + '-mode-toggle';

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = prefix + '-mode-btn' + (pageLayoutMode === 'auto' ? ' active' : '');
    autoBtn.textContent = 'Auto';
    autoBtn.addEventListener('click', () => setPageLayoutMode('auto'));

    const manualBtn = document.createElement('button');
    manualBtn.type = 'button';
    manualBtn.className = prefix + '-mode-btn' + (pageLayoutMode === 'manual' ? ' active' : '');
    manualBtn.textContent = 'Manual';
    manualBtn.addEventListener('click', () => setPageLayoutMode('manual'));

    modeRow.appendChild(autoBtn);
    modeRow.appendChild(manualBtn);
    wrapper.appendChild(modeRow);

    // Page count selector (manual mode)
    if (pageLayoutMode === 'manual') {
        const countRow = document.createElement('div');
        countRow.className = prefix + '-page-count';

        const countLabel = document.createElement('span');
        countLabel.className = prefix + '-page-count-label';
        countLabel.textContent = 'Pages:';
        countRow.appendChild(countLabel);

        [1, 2, 3].forEach(n => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = prefix + '-page-count-btn' + (targetPageCount === n ? ' active' : '');
            btn.textContent = n;
            btn.addEventListener('click', () => setTargetPageCount(n));
            countRow.appendChild(btn);
        });

        wrapper.appendChild(countRow);
    }

    // Text size control
    const shrinkRow = document.createElement('div');
    shrinkRow.className = prefix + '-shrink-control';

    const shrinkLabel = document.createElement('span');
    shrinkLabel.className = prefix + '-shrink-label';
    shrinkLabel.textContent = 'Text:';

    const shrinkDown = document.createElement('button');
    shrinkDown.type = 'button';
    shrinkDown.className = prefix + '-shrink-btn';
    shrinkDown.textContent = 'A\u2212';
    shrinkDown.addEventListener('click', () => adjustTextSize(-5));

    const shrinkValue = document.createElement('span');
    shrinkValue.className = prefix + '-shrink-value';
    shrinkValue.textContent = textShrinkPercent + '%';

    const shrinkUp = document.createElement('button');
    shrinkUp.type = 'button';
    shrinkUp.className = prefix + '-shrink-btn';
    shrinkUp.textContent = 'A+';
    shrinkUp.addEventListener('click', () => adjustTextSize(5));

    const shrinkReset = document.createElement('button');
    shrinkReset.type = 'button';
    shrinkReset.className = prefix + '-shrink-btn';
    shrinkReset.textContent = 'Reset';
    shrinkReset.style.display = textShrinkPercent === 100 ? 'none' : '';
    shrinkReset.addEventListener('click', () => {
        textShrinkPercent = 100;
        document.documentElement.style.setProperty('--text-scale', '1');
        reRenderWithCurrentOrder();
    });

    shrinkRow.appendChild(shrinkLabel);
    shrinkRow.appendChild(shrinkDown);
    shrinkRow.appendChild(shrinkValue);
    shrinkRow.appendChild(shrinkUp);
    shrinkRow.appendChild(shrinkReset);
    wrapper.appendChild(shrinkRow);

    return wrapper;
}

function adjustTextSize(delta) {
    textShrinkPercent = Math.max(50, Math.min(100, textShrinkPercent + delta));
    document.documentElement.style.setProperty('--text-scale', textShrinkPercent / 100);
    reRenderWithCurrentOrder();
}

function setPageLayoutMode(mode) {
    pageLayoutMode = mode;
    if (mode === 'manual') {
        // Always recalculate from current state when entering manual mode
        const currentPages = document.querySelectorAll('#resume-render-target .resume-page').length;
        targetPageCount = Math.max(1, Math.min(currentPages, 3));
        sectionPageAssignments = { ...computedPageAssignments };
    }
    if (mode === 'auto') {
        sectionPageAssignments = {};
        targetPageCount = null;
    }
    reRenderWithCurrentOrder();
}

function setTargetPageCount(n) {
    targetPageCount = n;
    // Clear manual assignments so sections get redistributed for the new page count
    sectionPageAssignments = {};
    reRenderWithCurrentOrder();
}

function updateOverflowWarning(overflowed) {
    const desktopWarn = document.getElementById('sidebar-overflow-warning');
    if (desktopWarn) desktopWarn.style.display = overflowed ? 'block' : 'none';
    const mobileWarn = document.getElementById('mobile-overflow-warning');
    if (mobileWarn) mobileWarn.style.display = overflowed ? 'block' : 'none';
}

// ============================================================
// Mobile Reorder Bottom Sheet
// ============================================================
function buildMobileReorderSheet() {
    const content = document.getElementById('mobile-reorder-content');
    if (!content) return;
    content.textContent = '';

    const activeDefs = getActiveSectionDefs();
    if (activeDefs.length === 0) return;

    // Page control UI
    content.appendChild(buildPageControlUI('mobile-reorder'));

    // Determine page count
    const pageCount = document.querySelectorAll('#resume-render-target .resume-page').length || 1;

    // Group sections by computed page
    const pageGroups = {};
    for (let p = 1; p <= pageCount; p++) pageGroups[p] = [];
    activeDefs.forEach(def => {
        const page = computedPageAssignments[def.id] || 1;
        const clamped = Math.min(Math.max(page, 1), pageCount);
        if (!pageGroups[clamped]) pageGroups[clamped] = [];
        pageGroups[clamped].push(def);
    });

    const maxPageOption = Math.max(pageCount, targetPageCount || 0, 3);
    let flatIdx = 0;
    const totalMovable = activeDefs.length;

    for (let p = 1; p <= pageCount; p++) {
        // Page divider
        if (pageCount > 1) {
            const divider = document.createElement('div');
            divider.className = 'mobile-reorder-page-divider';
            divider.textContent = 'Page ' + p;
            content.appendChild(divider);
        }

        // Header on page 1
        if (p === 1) {
            const headerItem = document.createElement('div');
            headerItem.className = 'mobile-reorder-item mobile-reorder-item-fixed';
            const headerLabel = document.createElement('span');
            headerLabel.className = 'mobile-reorder-item-label';
            headerLabel.textContent = 'Header';
            headerItem.appendChild(headerLabel);
            content.appendChild(headerItem);
        }

        // Section items
        (pageGroups[p] || []).forEach(def => {
            const item = document.createElement('div');
            item.className = 'mobile-reorder-item';
            item.dataset.sectionId = def.id;
            if (def.isCustomEntry) {
                item.dataset.isCustomEntry = 'true';
                item.dataset.label = def.label;
            }

            const currentIdx = flatIdx;

            const upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.className = 'mobile-reorder-arrow';
            upBtn.textContent = '\u25B2';
            upBtn.disabled = currentIdx === 0;
            upBtn.addEventListener('click', () => mobileMoveSectionUp(item));

            const downBtn = document.createElement('button');
            downBtn.type = 'button';
            downBtn.className = 'mobile-reorder-arrow';
            downBtn.textContent = '\u25BC';
            downBtn.disabled = currentIdx === totalMovable - 1;
            downBtn.addEventListener('click', () => mobileMoveSectionDown(item));

            const label = document.createElement('span');
            label.className = 'mobile-reorder-item-label';
            label.textContent = def.label;

            item.appendChild(upBtn);
            item.appendChild(label);
            item.appendChild(downBtn);

            // Page select
            if (pageCount > 1 || (pageLayoutMode === 'manual' && targetPageCount > 1)) {
                const select = document.createElement('select');
                select.className = 'mobile-reorder-page-select';
                for (let pp = 1; pp <= maxPageOption; pp++) {
                    const opt = document.createElement('option');
                    opt.value = pp;
                    opt.textContent = 'P' + pp;
                    select.appendChild(opt);
                }
                select.value = computedPageAssignments[def.id] || 1;
                select.addEventListener('change', () => {
                    const newPage = parseInt(select.value);
                    if (pageLayoutMode === 'auto') {
                        pageLayoutMode = 'manual';
                        targetPageCount = Math.max(pageCount, newPage);
                    }
                    // Pin all current positions before changing one
                    sectionPageAssignments = { ...computedPageAssignments };
                    sectionPageAssignments[def.id] = newPage;
                    if (targetPageCount !== null && newPage > targetPageCount) {
                        targetPageCount = newPage;
                    }
                    reRenderWithCurrentOrder();
                });
                item.appendChild(select);
            }

            content.appendChild(item);
            flatIdx++;
        });
    }

    // Overflow warning
    const warning = document.createElement('div');
    warning.className = 'mobile-reorder-overflow-warning';
    warning.id = 'mobile-overflow-warning';
    warning.style.display = 'none';
    warning.textContent = 'Content overflows target page count.';
    content.appendChild(warning);
}

function mobileMoveSectionUp(item) {
    let prev = item.previousElementSibling;
    // Skip page dividers and fixed items
    while (prev && (prev.classList.contains('mobile-reorder-page-divider') ||
                    prev.classList.contains('mobile-reorder-item-fixed'))) {
        prev = prev.previousElementSibling;
    }
    if (prev && prev.classList.contains('mobile-reorder-item')) {
        item.parentNode.insertBefore(item, prev);
        applyMobileReorder();
    }
}

function mobileMoveSectionDown(item) {
    let next = item.nextElementSibling;
    // Skip page dividers
    while (next && next.classList.contains('mobile-reorder-page-divider')) {
        next = next.nextElementSibling;
    }
    if (next && next.classList.contains('mobile-reorder-item') &&
        !next.classList.contains('mobile-reorder-item-fixed')) {
        item.parentNode.insertBefore(next, item);
        applyMobileReorder();
    }
}

function applyMobileReorder() {
    const content = document.getElementById('mobile-reorder-content');
    const items = content.querySelectorAll('.mobile-reorder-item:not(.mobile-reorder-item-fixed)');

    const newOrder = [];
    items.forEach(item => {
        const id = item.dataset.sectionId;
        if (item.dataset.isCustomEntry === 'true') {
            newOrder.push({
                id: id,
                label: item.dataset.label,
                isCustomEntry: true,
            });
        } else {
            const def = DEFAULT_SECTION_DEFS.find(d => d.id === id);
            if (def) newOrder.push(def);
        }
    });

    sectionOrder = newOrder;
    reRenderWithCurrentOrder();
}

// ============================================================
// Generate from YAML Editor
// ============================================================
function generateFromEditor() {
    const editorError = document.getElementById('editor-error');
    const yamlText = diffMode
        ? document.getElementById('diff-right-editor').value.trim()
        : document.getElementById('yaml-editor').value.trim();

    editorError.style.display = 'none';

    if (!yamlText) {
        editorError.textContent = 'Please enter some YAML content.';
        editorError.style.display = 'block';
        return;
    }

    try {
        const data = yamlToData(yamlText);
        if (!data.name) {
            editorError.textContent = 'YAML must contain a "name" field.';
            editorError.style.display = 'block';
            return;
        }
        lastYamlSource = 'editor';
        renderResumeFromData(data);
    } catch (err) {
        editorError.textContent = 'YAML parsing error: ' + err.message;
        editorError.style.display = 'block';
    }
}

// ============================================================
// Save YAML File
// ============================================================
function saveYamlFile() {
    const yamlText = diffMode
        ? document.getElementById('diff-right-editor').value
        : document.getElementById('yaml-editor').value;
    const blob = new Blob([yamlText], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume.yaml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================================
// AI Resume Generation
// ============================================================
const AI_SYSTEM_PROMPT = `You are a resume tailoring expert. Given a resume in YAML format and a job description, generate a tailored version of the resume YAML.

Rules:
- Return ONLY valid YAML. No markdown fences, no explanations, no extra text.
- Preserve the exact YAML schema: name, contact, work_experience (with company, title, location, dates, tagline, responsibilities), education (with institution, location, graduation_date, details), projects (with name, description, link, tools), awards (with name, awarder, date, summary), publications (with title, publisher, date, link, summary), custom_sections (with heading, content), skills (with technologies, hard_skills, language_skills).
- Tailor the responsibilities and skills to match the job description.
- Keep it truthful - rephrase and emphasize existing experience, do NOT fabricate new experience.
- Optimize keywords from the job description into the resume naturally.
- Keep responsibilities as bullet points (array items in YAML).`;

// Curated text chat models, smartest first
const PREFERRED_MODELS = [
    'gpt-5.2',
    'gpt-5.1',
    'gpt-5-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
    'gpt-4o-mini',
];

async function fetchOpenAiModels(apiKey) {
    const select = document.getElementById('ai-model');
    const hint = document.getElementById('ai-model-hint');
    const currentValue = select.value;

    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!response.ok) return;

        const data = await response.json();
        const availableIds = new Set(data.data.map(m => m.id));

        // Keep only preferred models the user's key has access to
        const models = PREFERRED_MODELS.filter(id => availableIds.has(id));

        if (models.length === 0) return;

        select.textContent = '';
        models.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = id;
            select.appendChild(opt);
        });

        // Restore previous selection or default to smartest (first in list)
        if (models.includes(currentValue)) {
            select.value = currentValue;
        } else {
            select.value = models[0];
        }

        hint.textContent = `${models.length} models available.`;
    } catch (e) {
        // Silently keep the default options
    }
}

async function generateAiResume() {
    const apiKey = document.getElementById('openai-key').value.trim();
    const baseYaml = document.getElementById('ai-base-yaml').value.trim();
    const jobDesc = document.getElementById('job-description').value.trim();
    const errorEl = document.getElementById('ai-error');
    const loadingEl = document.getElementById('ai-loading');
    const generateBtn = document.getElementById('generate-ai-btn');

    errorEl.style.display = 'none';

    if (!apiKey) {
        errorEl.textContent = 'Please enter your OpenAI API key.';
        errorEl.style.display = 'block';
        return;
    }
    if (!baseYaml) {
        errorEl.textContent = 'Please provide your base resume YAML.';
        errorEl.style.display = 'block';
        return;
    }
    if (!jobDesc) {
        errorEl.textContent = 'Please paste the job description.';
        errorEl.style.display = 'block';
        return;
    }

    // Validate the base YAML first
    try {
        jsyaml.load(baseYaml);
    } catch (err) {
        errorEl.textContent = 'Base YAML is invalid: ' + err.message;
        errorEl.style.display = 'block';
        return;
    }

    loadingEl.style.display = 'flex';
    generateBtn.disabled = true;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: document.getElementById('ai-model').value,
                messages: [
                    { role: 'system', content: AI_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: `Here is my resume YAML:\n\n${baseYaml}\n\nHere is the job description:\n\n${jobDesc}\n\nGenerate a tailored resume YAML that optimizes my experience for this role.`,
                    },
                ],
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const message = errorData.error?.message || `API request failed (${response.status})`;
            throw new Error(message);
        }

        const result = await response.json();
        let generatedYaml = result.choices[0].message.content.trim();

        // Strip markdown fences if present
        generatedYaml = generatedYaml.replace(/^```(?:yaml|yml)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

        // Validate the generated YAML
        try {
            jsyaml.load(generatedYaml);
        } catch (parseErr) {
            throw new Error('AI generated invalid YAML. Please try again.');
        }

        // Navigate to editor with side-by-side diff view
        const originalYaml = document.getElementById('ai-base-yaml').value.trim();
        lastYamlSource = 'ai';
        showView('editor-view');
        enterDiffMode(originalYaml, generatedYaml);

    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    } finally {
        loadingEl.style.display = 'none';
        generateBtn.disabled = false;
    }
}

// ============================================================
// PDF Download
// ============================================================
function downloadPDF() {
    const renderTarget = document.getElementById('resume-render-target');
    renderTarget.style.position = 'static';
    renderTarget.style.left = 'auto';

    const filename = lastResumeData?.name ? `${lastResumeData.name} Resume.pdf` : 'Resume.pdf';

    // Render the entire render target; each .resume-page is exactly 11in tall,
    // so html2pdf naturally creates one PDF page per .resume-page
    html2pdf().set({
        margin: 0,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    }).from(renderTarget).save().then(() => {
        renderTarget.style.position = 'absolute';
        renderTarget.style.left = '-9999px';
    });
}

// ============================================================
// Print Resume
// ============================================================
function printResume() {
    const renderTarget = document.getElementById('resume-render-target');
    renderTarget.style.position = 'static';
    renderTarget.style.left = 'auto';
    window.print();
    renderTarget.style.position = 'absolute';
    renderTarget.style.left = '-9999px';
}

// ============================================================
// Load Example Data
// ============================================================
function loadExample() {
    document.getElementById('jobs-container').textContent = '';
    document.getElementById('education-container').textContent = '';
    document.getElementById('projects-container').textContent = '';
    document.getElementById('awards-container').textContent = '';
    document.getElementById('publications-container').textContent = '';
    document.getElementById('custom-sections-container').textContent = '';
    jobCounter = 0;
    eduCounter = 0;
    projectCounter = 0;
    awardCounter = 0;
    publicationCounter = 0;
    customSectionCounter = 0;

    document.getElementById('name').value = 'Dwight K. Schrute III';
    document.getElementById('email').value = 'dschrute@schrutefarms.com';
    document.getElementById('phone').value = '(570) 555-1212';
    document.getElementById('location').value = 'Scranton, PA';
    document.getElementById('linkedin').value = '';
    document.getElementById('github').value = '';

    addJobEntry({
        company: 'Dunder Mifflin',
        title: 'Regional Manager',
        location: 'Scranton, PA',
        dates: 'May 2013 - Present',
        tagline: '',
        responsibilities: 'Maintained the highest sales average, despite the weak economy and obsolete product.\nManaged, inspired, and protected the Scranton branch from criminals and raccoons.\nLed the office to obtain immeasurable success and glory.',
    });

    addJobEntry({
        company: 'Dunder Mifflin',
        title: 'Assistant (to the) Regional Manager',
        location: 'Scranton, PA',
        dates: 'Mar 2008 - Mar 2013',
        tagline: '',
        responsibilities: 'Closed more sales with revenues totaling more profit than any other employee - past, present, and future (projected).\nServed as self-appointed enforcer of The Rules (policies and procedures manual).\nInstituted "Schrute Bucks" reward system, immeasurably raising office morale.',
    });

    addJobEntry({
        company: 'Staples',
        title: "Sale's Associate",
        location: 'Scranton, PA',
        dates: 'Mar 2008 - Mar 2008',
        tagline: '',
        responsibilities: 'Became the top salesman of the store within a one-month timespan.\nMade a record-high sales figure despite having an unfunny boss.\nProvided extraordinary and exceptional customer service to the masses.',
    });

    addJobEntry({
        company: 'Dunder Mifflin',
        title: 'Assistant (to the) Regional Manager',
        location: 'Scranton, PA',
        dates: 'Mar 2005 - Mar 2008',
        tagline: '',
        responsibilities: "Acted as Regional Manager's eyes, ears, and right hand, overseeing and reporting on employee conduct, productivity, and arrival/departure times.\nProvided services to the office such as martial arts and surveillance.\nIntroduced new linen paper lines into the market, often closing sight-unseen sales of newly released products.",
    });

    addEducationEntry({
        institution: 'Scranton University',
        location: 'Scranton, PA',
        graduation_date: '1998',
        details: 'BA Business Administration',
    });

    addProjectEntry({
        name: 'Schrute Farms (Bed and Breakfast)',
        description: 'A beautiful resort that provides fun activities like tablemaking and mattress making.',
        link: '',
        tools: '',
    });

    addProjectEntry({
        name: "Dwight Schrute's Gym for Muscles",
        description: 'A built-in gym inside the Dunder Mifflin office that will make you shredded.',
        link: '',
        tools: '',
    });

    addProjectEntry({
        name: 'Sesame Avenue Daycare Center for Infants and Toddlers',
        description: 'A great daycare for infants with a focus on cognitive development.',
        link: '',
        tools: '',
    });

    addAwardEntry({
        name: 'Salesman of the Month',
        awarder: 'Dunder Mifflin',
        date: '2005',
        summary: '13-time award winner - honored for having the most sales of the month.',
    });

    addCustomSectionEntry({
        heading: 'Interests & Hobbies',
        content: 'Beet farming\nIdentity theft investigation\nSurvival skills and wilderness training\nBattlestar Galactica',
    });

    document.getElementById('technologies').value = '';
    document.getElementById('hard-skills').value = 'Hardworking, Alpha Male, Jackhammer, Merciless, Insatiable';
    document.getElementById('language-skills').value = 'Karate (Purple Belt), Jujitsu, Werewolf hunting, Table Making';

    saveToLocalStorage();
}

// ============================================================
// Diff View
// ============================================================
function enterDiffMode(original, generated) {
    diffMode = true;
    originalYamlForDiff = original;

    document.getElementById('single-editor-container').style.display = 'none';
    document.getElementById('diff-container').style.display = 'flex';
    document.getElementById('diff-stats').style.display = 'flex';
    document.querySelector('.editor-container').classList.add('diff-active');

    document.getElementById('accept-changes-btn').style.display = '';
    document.getElementById('revert-changes-btn').style.display = '';

    const rightEditor = document.getElementById('diff-right-editor');
    rightEditor.value = generated;

    renderDiff(original, generated);

    rightEditor.addEventListener('input', onDiffEditorInput);
    rightEditor.addEventListener('scroll', onRightEditorScroll);
    document.getElementById('diff-left-content').addEventListener('scroll', onLeftPaneScroll);
}

function exitDiffMode(yamlToKeep) {
    diffMode = false;

    document.getElementById('single-editor-container').style.display = '';
    document.getElementById('diff-container').style.display = 'none';
    document.getElementById('diff-stats').style.display = 'none';
    document.querySelector('.editor-container').classList.remove('diff-active');

    document.getElementById('accept-changes-btn').style.display = 'none';
    document.getElementById('revert-changes-btn').style.display = 'none';

    document.getElementById('yaml-editor').value = yamlToKeep;

    const rightEditor = document.getElementById('diff-right-editor');
    rightEditor.removeEventListener('input', onDiffEditorInput);
    rightEditor.removeEventListener('scroll', onRightEditorScroll);
    document.getElementById('diff-left-content').removeEventListener('scroll', onLeftPaneScroll);

    if (rediffTimeout) {
        clearTimeout(rediffTimeout);
        rediffTimeout = null;
    }
}

function renderDiff(oldText, newText) {
    const changes = Diff.diffLines(oldText, newText);

    // Left pane: show removed lines and context (skip added)
    const leftContent = document.getElementById('diff-left-content');
    leftContent.textContent = '';
    // Inner wrapper so all lines stretch to the widest line's width on horizontal scroll
    const leftInner = document.createElement('div');
    leftInner.style.display = 'inline-block';
    leftInner.style.minWidth = '100%';
    leftContent.appendChild(leftInner);

    // Right pane highlights: show added lines and context (skip removed)
    const rightHighlights = document.getElementById('diff-right-highlights');
    rightHighlights.textContent = '';

    let addedCount = 0;
    let removedCount = 0;
    let unchangedCount = 0;

    changes.forEach(part => {
        const lines = part.value.replace(/\n$/, '').split('\n');

        if (part.removed) {
            removedCount += lines.length;
            lines.forEach(line => {
                const div = document.createElement('div');
                div.className = 'diff-line diff-line-removed';
                div.textContent = line || ' ';
                leftInner.appendChild(div);
            });
        } else if (part.added) {
            addedCount += lines.length;
            lines.forEach(line => {
                const div = document.createElement('div');
                div.className = 'diff-line diff-line-added';
                div.textContent = line || ' ';
                rightHighlights.appendChild(div);
            });
        } else {
            unchangedCount += lines.length;
            lines.forEach(line => {
                const leftDiv = document.createElement('div');
                leftDiv.className = 'diff-line diff-line-context';
                leftDiv.textContent = line || ' ';
                leftInner.appendChild(leftDiv);

                const rightDiv = document.createElement('div');
                rightDiv.className = 'diff-line diff-line-context';
                rightDiv.textContent = line || ' ';
                rightHighlights.appendChild(rightDiv);
            });
        }
    });

    // Update stats
    const totalCount = addedCount + removedCount + unchangedCount;
    document.getElementById('diff-stat-total').textContent = `${totalCount} lines`;
    document.getElementById('diff-stat-added').textContent = `+${addedCount} added`;
    document.getElementById('diff-stat-removed').textContent = `-${removedCount} removed`;
    document.getElementById('diff-stat-unchanged').textContent = `${unchangedCount} unchanged`;
}

function onDiffEditorInput() {
    if (rediffTimeout) clearTimeout(rediffTimeout);
    rediffTimeout = setTimeout(() => {
        const newValue = document.getElementById('diff-right-editor').value;
        renderDiff(originalYamlForDiff, newValue);
        syncHighlightsScroll();
    }, 300);
}

function syncHighlightsScroll() {
    const editor = document.getElementById('diff-right-editor');
    const highlights = document.getElementById('diff-right-highlights');
    highlights.style.transform = `translate(-${editor.scrollLeft}px, -${editor.scrollTop}px)`;
}

function onRightEditorScroll() {
    syncHighlightsScroll();
    const editor = document.getElementById('diff-right-editor');
    const leftContent = document.getElementById('diff-left-content');
    // Proportional scroll sync
    const editorRatio = editor.scrollHeight > editor.clientHeight
        ? editor.scrollTop / (editor.scrollHeight - editor.clientHeight)
        : 0;
    if (leftContent.scrollHeight > leftContent.clientHeight) {
        leftContent.scrollTop = editorRatio * (leftContent.scrollHeight - leftContent.clientHeight);
    }
}

function onLeftPaneScroll() {
    const leftContent = document.getElementById('diff-left-content');
    const editor = document.getElementById('diff-right-editor');
    const leftRatio = leftContent.scrollHeight > leftContent.clientHeight
        ? leftContent.scrollTop / (leftContent.scrollHeight - leftContent.clientHeight)
        : 0;
    if (editor.scrollHeight > editor.clientHeight) {
        editor.scrollTop = leftRatio * (editor.scrollHeight - editor.clientHeight);
    }
    syncHighlightsScroll();
}

// ============================================================
// LocalStorage Persistence
// ============================================================
function saveToLocalStorage() {
    try {
        const data = collectFormData();
        localStorage.setItem('resume-generator-data', JSON.stringify(data));
    } catch (e) { /* ignore */ }
}

function restoreFromLocalStorage() {
    try {
        const saved = localStorage.getItem('resume-generator-data');
        if (!saved) return;

        const data = JSON.parse(saved);
        if (data.name) document.getElementById('name').value = data.name;
        if (data.contact) {
            if (data.contact.email) document.getElementById('email').value = data.contact.email;
            if (data.contact.phone) document.getElementById('phone').value = data.contact.phone;
            if (data.contact.location) document.getElementById('location').value = data.contact.location;
            if (data.contact.linkedin) document.getElementById('linkedin').value = data.contact.linkedin;
            if (data.contact.github) document.getElementById('github').value = data.contact.github;
        }
        if (data.work_experience && data.work_experience.length > 0) {
            document.getElementById('jobs-container').textContent = '';
            jobCounter = 0;
            data.work_experience.forEach(job => {
                addJobEntry({ ...job, responsibilities: job.responsibilities ? job.responsibilities.join('\n') : '' });
            });
        }
        if (data.education && data.education.length > 0) {
            document.getElementById('education-container').textContent = '';
            eduCounter = 0;
            data.education.forEach(edu => addEducationEntry(edu));
        }
        if (data.projects && data.projects.length > 0) {
            document.getElementById('projects-container').textContent = '';
            projectCounter = 0;
            data.projects.forEach(project => addProjectEntry(project));
        }
        if (data.awards && data.awards.length > 0) {
            document.getElementById('awards-container').textContent = '';
            awardCounter = 0;
            data.awards.forEach(award => addAwardEntry(award));
        }
        if (data.publications && data.publications.length > 0) {
            document.getElementById('publications-container').textContent = '';
            publicationCounter = 0;
            data.publications.forEach(pub => addPublicationEntry(pub));
        }
        if (data.custom_sections && data.custom_sections.length > 0) {
            document.getElementById('custom-sections-container').textContent = '';
            customSectionCounter = 0;
            data.custom_sections.forEach(section => addCustomSectionEntry(section));
        }
        if (data.skills) {
            if (data.skills.technologies) document.getElementById('technologies').value = data.skills.technologies.join(', ');
            if (data.skills.hard_skills) document.getElementById('hard-skills').value = data.skills.hard_skills.join(', ');
            if (data.skills.language_skills) document.getElementById('language-skills').value = data.skills.language_skills;
        }
    } catch (e) { /* ignore */ }
}
