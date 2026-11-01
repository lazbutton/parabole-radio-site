/**
 * Les textes longs du CMS (descriptions, bios, pages) sont en Markdown. Rendus sans HTML brut (cms/README.md, 9.6) :
 * une balise tapée s'affiche comme du texte, et les liens javascript: ou data: sont refusés. Un simple retour à la
 * ligne en est un aussi, comme on l'attend en écrivant une bio.
 */
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export const renderMarkdown = (text: string): string => markdown.render(text);
