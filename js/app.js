// ============================================================
// State
// ============================================================
let currentStep = 1;
const totalSteps = 4;
let jobCounter = 0;
let eduCounter = 0;
let lastResumeData = null; // Stores the data used to render the current preview
let lastYamlSource = null; // Tracks where preview came from: 'wizard', 'editor', 'ai'
let originalYamlForDiff = null; // Base YAML before AI modification
let diffMode = false;            // Whether diff view is active
let rediffTimeout = null;        // Debounce timer for re-diffing on edit

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

    // Wizard navigation
    document.getElementById('next-btn').addEventListener('click', nextStep);
    document.getElementById('prev-btn').addEventListener('click', prevStep);
    document.getElementById('add-job').addEventListener('click', () => addJobEntry());
    document.getElementById('add-education').addEventListener('click', () => addEducationEntry());
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
    data.skills = data.skills || {};
    // Ensure responsibilities are arrays
    data.work_experience.forEach(job => {
        if (typeof job.responsibilities === 'string') {
            job.responsibilities = job.responsibilities.split('\n').map(s => s.trim()).filter(Boolean);
        }
        job.responsibilities = job.responsibilities || [];
    });
    return data;
}

// ============================================================
// Render Resume from Data Object
// ============================================================
function renderResumeFromData(data) {
    lastResumeData = data;

    const renderTarget = document.getElementById('resume-render-target');

    // Temporarily make visible for accurate measurement
    renderTarget.style.position = 'static';
    renderTarget.style.left = 'auto';

    populateResumeDOM(data);

    // Use rAF to ensure browser has laid out the element before measuring
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            adjustContentToPage();

            // Show the preview
            showView('preview-view');

            // Need another rAF to ensure preview-view is visible and has width
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

// ============================================================
// Auto-fit content to page
// ============================================================
function adjustContentToPage() {
    const container = document.getElementById('rp-resume-container');
    if (!container) return;

    const resizableElements = Array.from(container.querySelectorAll('.js-resizable-text'));
    const targetHeight = container.clientHeight;
    if (resizableElements.length === 0 || targetHeight === 0) return;

    const initialFontSizes = resizableElements.map(el => {
        el.style.fontSize = '';
        return parseFloat(window.getComputedStyle(el).fontSize);
    });

    const applyScale = (scale) => {
        resizableElements.forEach((el, index) => {
            el.style.fontSize = `${initialFontSizes[index] * scale}px`;
        });
    };

    let minScale = 0.1;
    let maxScale = 1.0;
    let bestScale = 1.0;

    for (let i = 0; i < 10; i++) {
        let midScale = (minScale + maxScale) / 2;
        applyScale(midScale);
        if (container.scrollHeight > targetHeight) {
            maxScale = midScale;
        } else {
            bestScale = midScale;
            minScale = midScale;
        }
    }

    applyScale(bestScale);
}

// ============================================================
// Show the Preview (scaled to fit the preview container)
// ============================================================
function showPreview() {
    const wrapper = document.getElementById('resume-preview-wrapper');
    const resumePage = document.getElementById('resume-page');

    const clone = resumePage.cloneNode(true);
    clone.id = 'resume-preview-clone';

    const wrapperWidth = wrapper.clientWidth - 48;
    const pageWidth = 8.5 * 96;
    const pageHeight = 11 * 96;
    const scale = Math.min(wrapperWidth / pageWidth, 1);

    const scaler = document.createElement('div');
    scaler.className = 'resume-preview-scaler';
    scaler.style.transform = `scale(${scale})`;
    scaler.style.transformOrigin = 'top center';
    scaler.style.width = `${pageWidth}px`;
    scaler.style.height = `${pageHeight}px`;
    // Collapse extra layout space so wrapper sizes to the visual height
    scaler.style.marginBottom = `-${pageHeight - pageHeight * scale}px`;
    scaler.appendChild(clone);

    wrapper.textContent = '';
    wrapper.appendChild(scaler);

    // Let wrapper size naturally from its content
    wrapper.style.height = '';
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
- Preserve the exact YAML schema: name, contact, work_experience (with company, title, location, dates, tagline, responsibilities), education (with institution, location, graduation_date, details), skills (with technologies, hard_skills, language_skills).
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
    const resumePage = document.getElementById('resume-page');
    const renderTarget = document.getElementById('resume-render-target');
    renderTarget.style.position = 'static';
    renderTarget.style.left = 'auto';

    const filename = lastResumeData?.name ? `${lastResumeData.name} Resume.pdf` : 'Resume.pdf';

    html2pdf().set({
        margin: 0,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    }).from(resumePage).save().then(() => {
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
    jobCounter = 0;
    eduCounter = 0;

    document.getElementById('name').value = 'Jane Smith';
    document.getElementById('email').value = 'jane.smith@email.com';
    document.getElementById('phone').value = '(555) 987-6543';
    document.getElementById('location').value = 'San Francisco, CA';
    document.getElementById('linkedin').value = 'https://linkedin.com/in/janesmith';
    document.getElementById('github').value = 'https://github.com/janesmith';

    addJobEntry({
        company: 'TECH INNOVATIONS INC.',
        title: 'Senior Software Engineer',
        location: 'San Francisco, CA',
        dates: 'March 2021 - Present',
        tagline: 'A fast-growing SaaS company building next-generation developer tools for enterprise teams.',
        responsibilities: 'Architected and deployed a microservices platform handling 50M+ API calls daily, improving system reliability to 99.99% uptime\nLed a cross-functional team of 8 engineers through an agile migration, reducing sprint cycle time by 35%\nDesigned and implemented a real-time data pipeline using Kafka and PostgreSQL, cutting report generation time from 4 hours to 12 minutes\nMentored 4 junior developers through structured code reviews and pair programming sessions',
    });

    addJobEntry({
        company: 'DATAFLOW SYSTEMS',
        title: 'Software Engineer',
        location: 'Austin, TX',
        dates: 'June 2018 - February 2021',
        tagline: 'A mid-size analytics company providing business intelligence solutions to Fortune 500 clients.',
        responsibilities: 'Built a customer-facing dashboard using React and D3.js, increasing user engagement by 45%\nOptimized database queries and implemented caching strategies, reducing average page load time by 60%\nDeveloped automated testing suite with 95% code coverage using Jest and Cypress\nCollaborated with product managers to define technical requirements for 12 major feature releases',
    });

    addEducationEntry({
        institution: 'University of California, Berkeley',
        location: 'Berkeley, CA',
        graduation_date: 'May 2018',
        details: 'Bachelor of Science in Computer Science | Dean\'s List 2016-2018 | GPA: 3.85',
    });

    document.getElementById('technologies').value = 'Python, JavaScript, TypeScript, React, Node.js, PostgreSQL, Docker, Kubernetes, AWS, Git, Kafka, Redis';
    document.getElementById('hard-skills').value = 'System Design, Microservices Architecture, Agile/Scrum, Technical Leadership, CI/CD, Performance Optimization';
    document.getElementById('language-skills').value = 'Fluent in English and Spanish';

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
        if (data.skills) {
            if (data.skills.technologies) document.getElementById('technologies').value = data.skills.technologies.join(', ');
            if (data.skills.hard_skills) document.getElementById('hard-skills').value = data.skills.hard_skills.join(', ');
            if (data.skills.language_skills) document.getElementById('language-skills').value = data.skills.language_skills;
        }
    } catch (e) { /* ignore */ }
}
