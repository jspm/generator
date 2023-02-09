import { LitElement, html, css } from 'lit';

export class MyElement extends LitElement {
  static styles = css`
    div {
      display: block;
    }
    
    span {
      color: red;
    }
  `;

  static properties = {
    mood: { type: String },
  }

  render() {
    return html`
      <div>
        Test files are <span>${this.mood}</span>!
      </div>
    `;
  }
}

customElements.define('my-element', MyElement);
