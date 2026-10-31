import { createLibrary } from "@openuidev/react-lang";
import { actions } from "./actions";
import { Chart } from "./components/chart";
import { Carousel, Code, Flashcard, MathBlock, Popover, Quote } from "./components/extra";
import {
  Button,
  Checkbox,
  DatePicker,
  IconButton,
  Input,
  Pressable,
  RadioGroup,
  SegmentedControl,
  Select,
  Slider,
  TextArea,
  Timer,
} from "./components/controls";
import { Flow, FlowArrow, FlowGroup, FlowNode, FlowRow } from "./components/flow";
import { HtmlView } from "./components/html-view";
import { Box, Card, Col, Divider, Form, Grid, Row, Spacer } from "./components/layout";
import { Icon, Image, SearchImage } from "./components/media";
import { svgComponents } from "./components/svg";
import { Table } from "./components/table";
import { Badge, Caption, Label, Link, List, ListItem, Markdown, Text, Title } from "./components/text";
import { functions } from "./functions";
import "./components/theme.css";
import "./components/components.css";

/**
 * Primitives the model arranges itself, plus a few widgets for what a model
 * cannot draw by hand (a diagram, a chart, a sandboxed HTML page). Layout is
 * never fixed here. Generic @functions let a block compute with its own state,
 * so an answer can hold a working tool rather than a form sent back to the
 * assistant. The street map, video and confetti widgets of the upstream demo
 * are left out: they load third-party content or do not fit a coding agent.
 */
export const components = [
  Col, Row, Box, Grid, Card, Carousel, Popover, Divider, Spacer,
  Title, Text, Caption, Label, Badge, Link, List, ListItem, Markdown, Quote, Code, MathBlock,
  Flow, FlowNode, FlowArrow, FlowRow, FlowGroup,
  Icon, Table, Chart, SearchImage, Image,
  Button, IconButton, Pressable, Input, TextArea, Select, SegmentedControl, Slider, Checkbox, RadioGroup, DatePicker, Timer, Form,
  Flashcard,
  ...svgComponents, HtmlView,
];

export const componentGroups = [
  {
    name: "Layout",
    components: ["Col", "Row", "Box", "Grid", "Card", "Carousel", "Popover", "Divider", "Spacer"],
    notes: [
      '- gap and padding count 4px steps. Length is px or a CSS length like "50%". Radius is "sm", "md", "lg", "xl", "full" or px.',
      '- Color is "ink", "muted", "faint", "surface", "info", "success", "warning", "danger", "purple", "pink", "chart1" to "chart6", or a CSS color. As a background, status colors are soft tints.',
    ],
  },
  { name: "Text", components: ["Title", "Text", "Caption", "Label", "Badge", "Link", "List", "ListItem", "Markdown", "Quote", "Code", "Math"] },
  { name: "Diagrams", components: ["Flow", "FlowNode", "FlowArrow", "FlowRow", "FlowGroup"] },
  { name: "Media and data", components: ["Icon", "Table", "Chart", "SearchImage", "Image"] },
  {
    name: "Inputs",
    components: ["Button", "IconButton", "Pressable", "Input", "TextArea", "Select", "SegmentedControl", "Slider", "Checkbox", "RadioGroup", "DatePicker", "Timer", "Form"],
    notes: [
      "- An input's first argument is its value, usually a $variable that other statements read.",
      '- Every input either changes something shown in the block, or sits in a Form whose submit Button sends a short first-person @ToAssistant ("Help me choose a database"); the form values go with it. No dead inputs.',
    ],
  },
  { name: "Play", components: ["Flashcard"] },
  { name: "Drawing", components: ["Svg", "G", "Circle", "Ellipse", "Rect", "Line", "Path", "Polyline", "Polygon", "SvgText", "HtmlView"] },
];

export const library = createLibrary({
  root: "Col",
  components,
  functions,
  actions,
  componentGroups,
});
