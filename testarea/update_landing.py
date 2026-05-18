import re

file_path = r"c:\Users\user\OneDrive - Department of Premier Western Cape\GitHub\wcedsessions\testarea\collections\ms-sessions-landing-page.html"

with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

# 1. Replace the CSS block for buttons
css_to_find = """.actions {
display:flex;
flex-wrap:wrap;
gap:.6rem;
margin-top:1rem;
}
.btn {
text-decoration:none;
padding:.75rem 1rem;
border-radius:10px;
font-weight:600;
font-size:.9rem;
transition:all .25s ease;
}
.btn:hover {transform:translateY(-2px)}
.register {
background:#001489;
color:white;
}
.calendar {
background:#007DBA;
color:white;
}
.outlook {
background:#8FAD15;
}"""

replacement_css = """.actions {
display: grid;
grid-template-columns: 1fr 1fr;
gap: 0.75rem;
margin-top: 1rem;
}
.btn {
text-decoration: none;
border-radius: 8px;
font-size: 0.85rem;
font-weight: 600;
transition: all .25s ease;
display: flex;
align-items: center;
justify-content: center;
}
.btn svg {
width: 16px;
height: 16px;
margin-right: 6px;
}
.btn:hover {transform:translateY(-2px)}
.register {
grid-column: 1 / -1;
background: #004B87;
color: white;
padding: 0.6rem 1rem;
box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.register:hover {
background: #003366;
box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}
.calendar {
background: white;
color: #4b5563;
border: 1px solid #e5e7eb;
padding: 0.5rem;
box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.calendar:hover {
border-color: #004B87;
background: #eff6ff;
color: #004B87;
}

.header-links { display: flex; gap: 1rem; align-items: center; }
.header-link {
color: #001489; text-decoration: none; font-weight: 600; font-size: 0.9rem;
padding: 0.5rem 1rem; border: 2px solid #001489; border-radius: 8px;
transition: all 0.3s ease; display: inline-flex; align-items: center;
}
.header-link:hover { background: #001489; color: white; }"""

text = text.replace(css_to_find, replacement_css)

# 2. Replace the HTML header
header_find = """<header class="header">
<div class="header-content">
<img alt="WCED eLearning" src="header.png"/>
</div>
</header>"""

header_replace = """<header class="header">
<div class="header-content">
<img alt="WCED eLearning" src="header.png"/>
<div class="header-links">
<a href="../index.html" class="header-link">← Back to Upcoming Sessions</a>
</div>
</div>
</header>"""

text = text.replace(header_find, header_replace)

# 3. Replace the Action blocks globally
actions_pattern = re.compile(
    r'<div class="actions">\s*<a class="btn register" href="([^"]+)" target="_blank">📝 Pre-register</a>\s*'
    r'<a class="btn calendar" href="([^"]+)" target="_blank">📅 Google Calendar</a>\s*'
    r'<a class="btn calendar outlook" href="([^"]+)" target="_blank">📆 Outlook</a>\s*</div>'
)

def format_actions(match):
    reg_url = match.group(1)
    cal_url = match.group(2)
    out_url = match.group(3)

    return f"""<div class="actions">
<a class="btn register" href="{reg_url}" target="_blank">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" x2="21" y1="14" y2="3" /></svg>
    Register Now
</a>
<a class="btn calendar" href="{cal_url}" target="_blank">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#004B87;"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /><line x1="10" x2="14" y1="16" y2="16" /><line x1="12" x2="12" y1="14" y2="18" /></svg>
    Google
</a>
<a class="btn calendar" href="{out_url}" target="_blank">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#60a5fa;"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /><path d="m9 16 2 2 4-4" /></svg>
    Outlook
</a>
</div>"""

text = actions_pattern.sub(format_actions, text)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(text)

print("HTML modifications complete.")
