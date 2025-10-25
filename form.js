// form.js

function analyzeForm() {
  const form = document.querySelector('form');
  if (!form) return null;

  const fields = [];
  const inputs = form.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (input.type === 'hidden' || input.type === 'submit') return;

    const label = document.querySelector(`label[for="${input.id}"]`) || input.closest('label');
    fields.push({
      name: input.name || input.id,
      type: input.tagName.toLowerCase(),
      inputType: input.type,
      label: label ? label.textContent.trim() : ''
    });
  });

  return { fields };
}

function fillForm(data) {
  if (!data || !data.structured) {
    console.warn('VOX.AI: No structured data to fill form');
    return;
  }

  let filledCount = 0;

  for (const [name, value] of Object.entries(data.structured)) {

    let inputs = document.querySelectorAll(`[name="${name}"]`);

    if (inputs.length === 0) {
      const inputById = document.getElementById(name);
      if (inputById) inputs = [inputById];
    }

    if (inputs.length > 0) {
      inputs.forEach(input => {
        if (input.type === 'radio') {
          if (input.value.toLowerCase() === value.toLowerCase()) {
            input.checked = true;
            filledCount++;
          }
        } else if (input.tagName.toLowerCase() === 'select') {
          const options = Array.from(input.options);
          const matchingOption = options.find(opt =>
            opt.value.toLowerCase().includes(value.toLowerCase()) ||
            opt.text.toLowerCase().includes(value.toLowerCase())
          );
          if (matchingOption) {
            input.value = matchingOption.value;
            filledCount++;
          }
        } else {
          input.value = value;
          filledCount++;
        }

        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } else {
      console.warn(`VOX.AI: Could not find form field: ${name}`);
    }
  }
}
